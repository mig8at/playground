# creditop-woocommerce

Copia local del **plugin de WordPress/WooCommerce** que pone "Paga a cuotas con Creditop" en el checkout de una tienda Woo y, al confirmar, **redirige al comprador a CreditOp con el carrito serializado en la URL**.

> Este README es para desarrollo/contexto. El `Readme.txt` de al lado es el readme **estándar de WordPress.org** (formato de distribución: `Stable tag`, `Changelog`, `Screenshots`). **No lo toques ni lo borres** — es lo que se publica.

## Por qué está acá

Porque este plugin es el **emisor original del contrato base64** del canal ecommerce. Todo lo que el backend de CreditOp decodifica en `/checkout/{hash}` sale de las ~10 líneas de `process_payment()`. Cuando algo del canal se rompe (billing vacío, monto raro, token inválido), la pregunta siempre es "¿qué mandó el plugin?" — y la respuesta está en `class-creditop-gateway.php:439-520`.

De acá se portaron los dos generadores que usa el harness:

| Port | Dónde | Lenguaje |
|---|---|---|
| `generate_checkout_url.php` | `/Users/miguelochoa/Desktop/CREDITOP/github/generate_checkout_url.php` | PHP (stubea `WC_DateTime`/`WC_Order_Item_Shipping` para no necesitar WooCommerce) |
| `ecommerceContract()` | `/Users/miguelochoa/Desktop/CREDITOP/playground/frontend-e2e/pkg/ecommerce.ts` | TS (reimplementa `serialize()` de PHP a mano) |

## Qué hace el plugin, en dos partes

**1 · Marketing (la mayor parte del código).** Banners inyectados por hooks: uno de encabezado (`add_homepage_banner`) enganchado a hooks de **WordPress/tema** (`wp_head` por defecto, o `get_header` / `wp_after_header` / `wp_after_navbar`), y uno en la ficha de producto (`display_custom_badge`) enganchado a hooks de **WooCommerce** (`woocommerce_before_add_to_cart_button` y compañía). Todo es HTML con estilos inline y `!important`, con tres variantes según `only_creditop` y el hash del comercio.

**2 · Pasarela (lo que importa).** `Creditop_Gateway extends WC_Payment_Gateway`. No cobra nada, no habla con ninguna API: **`process_payment()` devuelve un redirect** y ahí termina su trabajo. El plugin **no tiene handler de callback** — el resultado vuelve por la REST API propia de WooCommerce (ver abajo).

## El contrato de salida (lo verificable)

`class-creditop-gateway.php:508` arma:

```
{base_url}/ecommerce/{hash}/checkout?o=…&p=…&u=…&ps=…&t=…&config=…
```

| param | contenido | codificación en el plugin | quién lo decodifica |
|---|---|---|---|
| `o` | `$order->get_data()` sin `line_items` ni `meta_data` | `base64(serialize($array))` | `unserialize`, fallback `json_decode` |
| `p` | product_id / name / sku / price de cada ítem | `base64(wp_json_encode())` | `json_decode` |
| `u` | return URL (`get_return_url()`) | `base64(serialize($string))` | `unserialize` |
| `ps` | `get_rest_url(null,'/wc/v3/orders/')` | `base64(plano)` | plano |
| `t` | setting `token` | `base64(plano)` | comparado contra `allied_ecommerce_credentials.credential` |
| `config` | mapa de nombres de campo de billing | `base64(serialize(json_encode($array)))` | `unserialize` + `json_decode` |

Del lado receptor, `o`, `p`, `t`, `u`, `ps` son **obligatorios** (`config` no) — `WoocommerceController::show:37` en `github/legacy-application`. El `hash` de la URL es el de **`allied_branches.hash`** (sucursal, no entidad); si no existe → `403 "El comercio no está habilitado para Ecommerce"`, y si el token no matchea → `403 "Token invalido"`.

**La vuelta no pasa por el plugin.** CreditOp notifica el veredicto posteando a la URL de `ps` (`.../wp-json/wc/v3/orders/{orderId}`) con `{status}` y BasicAuth de `consumer_key/consumer_secret` — credenciales que la tienda le entrega a CreditOp por fuera y viven encriptadas en `allied_ecommerce_credentials`. O sea: **la actualización del pedido entra por la REST API estándar de WooCommerce**, no por un endpoint del plugin. El mapa de estados es la tabla `woocommerce_statuses` (`completed=11`, `cancelled=8`, `failed=6/7`).

## Cómo se prueba

No hay build ni dependencias: es PHP plano + un JS de 36 líneas. No hay `composer.json` ni `package.json`.

**Sin WordPress** (lo normal acá) — generá la URL y pegásela al wizard:

```bash
php /Users/miguelochoa/Desktop/CREDITOP/github/generate_checkout_url.php
# imprime http://localhost:5174/ecommerce/17f7b360/checkout?o=…&p=…&u=…&ps=…&t=…&config=…
```

Editá adentro `$baseUrl`, `$tokenRaw` y `$partnerHash` para apuntar a otro entorno/comercio.

**Con el harness** (arma el contrato leyendo la credencial real de la BD):

```bash
cd /Users/miguelochoa/Desktop/CREDITOP/playground/frontend-e2e
bin/ecommerce <merchant>        # entra por el checkout, monto a mano
bin/ecommerce <merchant> auto   # guiado desde la tienda
```

**Con backend-mcp** (solo la URL, sin navegador):

```bash
cd /Users/miguelochoa/Desktop/CREDITOP/playground/backend-mcp
bash scripts/dev.sh ecommerce              # sucursales que tienen credencial (las únicas que pueden entrar)
bash scripts/dev.sh ecommerce-url <merchant> [phone]
```

**Con WordPress de verdad:** copiar la carpeta a `wp-content/plugins/`, activar, y configurar en *WooCommerce → Ajustes → Pagos → Creditop*. No hay instalador ni migraciones.

## Mapa de archivos

| Archivo | Qué es |
|---|---|
| `creditop-gateway.php` | Entrypoint del plugin (cabecera `Plugin Name`, `Version: 1.0.20`). Registra el gateway en `woocommerce_payment_gateways` y declara compatibilidad con `cart_checkout_blocks`. |
| `class-creditop-gateway.php` | **El 95% de la lógica**: settings, banners, `process_payment()`. 523 líneas, casi todas HTML inline. |
| `class-creditop-block.php` | Integración con el checkout de **Blocks** (React). Solo registra `checkout.js` y expone `title/description/icon`. |
| `checkout.js` | El método de pago del lado Blocks: lee `wcSettings.getSetting('creditop_gateway_data')` y hace `registerPaymentMethod`. `canMakePayment: () => true`. |
| `Readme.txt` | Readme de WordPress.org. **No editar.** |
| `license` | GPL-2.0 completa. |
| `assets/` | **Vacío en esta copia** (ver gotchas). |

## Settings del plugin (`init_form_fields`)

| Campo | Para qué |
|---|---|
| `hash` | Hash de la **sucursal** aliada. Va en el path de la URL. Lo entrega CreditOp. |
| `token` | Credencial ecommerce de esa sucursal. Va en `t`. Lo entrega CreditOp. |
| `base_url` | Host destino. Default `https://originaciones.creditop.com`. |
| `first_name`, `surname`, `document_number`, `address`, `city`, `phone` | Renombres de campos de billing si la tienda los customizó. Van en `config` y el backend los usa como **fallback** de nombre de clave (`getBillingField`). |
| `homepage_widget_enabled` | Dónde mostrar el banner de encabezado: `home` / `all` / `all_except_product` / `none`. |
| `header_widget_position` | Posición del banner de encabezado. **No-op — ver gotchas.** |
| `before_add_to_cart_widget_enabled` | Posición del badge en la ficha de producto (7 hooks + `disable`). |
| `only_creditop` | Checkbox. Marcado = el widget muestra **solo** la marca Creditop; desmarcado = muestra logos de entidades. |

No hay campo `title` en los settings: el nombre visible está hardcodeado en **dos lugares que no coinciden** — `'Paga a cuotas con Creditop'` en `class-creditop-gateway.php:46` (checkout clásico/shortcode) y `'Creditop'` en `class-creditop-block.php:64` (checkout de **Blocks**, que llega al front vía `settings.title` en `checkout.js:21`). La descripción también diverge: el `<img>` de `assets/` en el clásico (`:49-54`), texto plano `'¡Revisa acá las diferentes opciones de financiamiento!'` en Blocks (`class-creditop-block.php:65`).

## Gotchas

- **`assets/` está vacío y el código referencia 17 archivos** (`creditop-styles.css`, `creditop-description.png`, `header1..6.png`, logos de bdb/bancolombia/sistecredito/credifis…). Si instalás esta copia tal cual, **todos los banners salen con imágenes rotas** y el `description` del **checkout clásico** es un `<img>` roto de 320px de alto (el checkout de Blocks no se ve afectado: su descripción es texto plano — ver settings). El `.zip` publicado sí los trae; acá se perdieron.

- **`base_url` parece un parche local, no parte del 1.0.20 publicado.** El campo y sus comentarios en español (`// OJO: el path del refactor es /ecommerce/{hash}/checkout (NO /checkout/{hash} como aliados)`) están solo en `class-creditop-gateway.php`, que es el único archivo con mtime posterior (16:12 vs 15:49) y el changelog del `Readme.txt` para 1.0.20 dice "Cambio en banners de producto". **Sin verificar contra el .zip de WordPress.org.** Antes apuntaba fijo a `https://aliados.creditop.com` (el monolito).

- **La ruta destino puede dar 404.** `/ecommerce/{hash}/checkout` **no existe** en el `loan-request-wizard` de `main` (finding **F-40**): la entrada unificada `app/routes/ecommerce/checkout.tsx` vive en `develop` (PR 551), no en `main`. En prod el entry lo sigue sirviendo el monolito `application` en `/checkout/{hash}` — salvo para los allieds de Corbeta `[24,209,210,211,311]`, que el monolito redirige a legacy-backend. Traducción: **con el `base_url` default el canal no es ejercitable end-to-end contra el wizard actual**; hay que apuntar a `aliados.creditop.com` (path viejo) o a la rama del front.

- **`header_widget_position` no hace nada (bug real).** El constructor lee `$header_position = $this->get_option('header_widget_position')` (línea 44) pero llama `$this->add_custom_header_hook($position)` con **`$position`**, que es el de la ficha de producto (línea 70). El `switch` recibe valores tipo `before_add_to_cart_button`, no matchea ningún `case` y siempre cae al `default` → `wp_head`. La variable `$header_position` queda sin usar.

- **`document_type` nunca se mapea.** El backend lo busca (`buildEcommerceData` pide `document_type`), pero los settings de `config` solo cubren `document_number` — no hay campo para el tipo. Si el billing de la tienda no tiene literalmente una clave `document_type`, llega `null`. `generate_checkout_url.php` lo inyecta a mano justo por eso.

- **Los params van sin urlencode.** El plugin concatena el base64 crudo en la URL, así que los `+` del base64 se decodifican como espacio del otro lado. Por eso el backend hace `str_replace(' ', '+', $encoded)` en los seis params antes de decodificar. Si escribís un cliente nuevo, o urlencodeás bien o replicás el parche.

- **El token viaja en claro** (base64 no es cifrado) en la query string del navegador del comprador, sin nonce ni firma. Es el diseño actual del contrato; anotado, no propuesto como bug a arreglar unilateralmente.

- **`only_creditop` tiene el label invertido respecto al título.** Título: "Mostrar entidades en widgets"; label del checkbox: "Solo saldrá nombre de Creditop". Marcarlo **oculta** las entidades. Default `yes`.

- **Hash de comercio hardcodeado en el código.** `38299332` dispara la variante white-label "Credifis" (otro badge, otro set de logos) en cuatro lugares distintos. Agregar otro white-label hoy implica tocar el PHP.

- **`p` no lleva cantidades ni totales de línea:** solo `product_id`, `name`, `sku`, `price` (precio unitario del producto). El monto autoritativo es `o.total`. Un pedido con qty 2 manda el precio una sola vez.

- **La versión del script de Blocks está fija en `'1.0.0'`** (`class-creditop-block.php:53`) aunque el plugin vaya en 1.0.20 → el `checkout.js` no rompe caché entre actualizaciones.

- **`wp_after_header` / `wp_after_navbar` no son hooks del core de WordPress** — son de tema. Si el tema no los dispara, esas dos opciones de posición no muestran nada. (Según el código; no probado en un WP real.)

## Docs relacionados

Ninguno dentro de esta carpeta salvo el `Readme.txt` (el de distribución). El contexto del canal vive afuera:

- `/Users/miguelochoa/Desktop/CREDITOP/playground/context/server/data/flows/ecommerce/doc.md` — **el doc maestro del canal**: contrato base64, tablas (`allied_ecommerce_credentials`, `ecommerce_requests`, `woocommerce_statuses`), notificadores por plataforma (Woo=1, self=2, VTEX=3), observer de estados finales, cutover por-allied.
- `/Users/miguelochoa/Desktop/CREDITOP/playground/context/server/data/flows/ecommerce-web-stateless/doc.md` — la task que mueve el entry al wizard sin cookie (PRs 795 backend / 551 front).
- `/Users/miguelochoa/Desktop/CREDITOP/playground/context/server/data/flows/findings/doc.md` — **F-40**: por qué el checkout da 404 contra el wizard de `main`.
- `/Users/miguelochoa/Desktop/CREDITOP/github/legacy-application/app/Http/Controllers/Customer/WoocommerceController.php` — el receptor histórico: decodifica el contrato, valida hash+token, notifica y cancela.
- `/Users/miguelochoa/Desktop/CREDITOP/playground/frontend-e2e/channel/ecommerce-*.spec.ts` — 5 specs del canal (`ecommerce-local-real` usa directamente `generate_checkout_url.php`). Marcadas **stale** por F-40.
- `/Users/miguelochoa/Desktop/CREDITOP/playground/backend-mcp/README.md` — comandos `ecommerce` y `ecommerce-url`.
