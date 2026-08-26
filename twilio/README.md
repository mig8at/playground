# Twilio — qué tenemos y cómo se crea un template de WhatsApp

Medido el **2026-08-26** con `./probe.py` (sólo GET; no se creó ni se mandó nada).

## 1. Dónde estás parado

| | |
|---|---|
| cuenta | `ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX` — friendly name **"Support"**, activa, creada 2026-04-29 |
| ⚠ es una **subcuenta** | su padre es `ACYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY` |
| sender de WhatsApp | **`whatsapp:+573138591194`** (`XE003855f0…`), perfil **"Creditop"**, **ONLINE**, WABA `27067723899526659` |
| otro sender | `whatsapp:+14155238886` OFFLINE = el **sandbox** de Twilio, número compartido de pruebas. Ignoralo |
| templates hoy | **0** |
| messaging services | **0** |
| números de teléfono (voz/SMS) | **0** |
| tráfico | 4 mensajes, **todos entrantes**, ninguno saliente. Consumo del mes pasado: 3 mensajes, **$0,015** |

⚠ **Todo es POR CUENTA.** Un template creado en esta subcuenta existe **sólo** acá: no lo ve el
padre ni ninguna cuenta hermana. Antes de crear, confirmá que ésta es la cuenta correcta para tu tarea.

## 2. Las credenciales del `.env`, y cuál usar

| var | forma | qué alcanza |
|---|---|---|
| `TWILIO_SID` + `TWILIO_TOKEN` | `AC…` + token | **acceso Full** a la subcuenta, lectura y escritura. Es la que sirve para aprender |
| `TWILIO_API_KEY` + `TWILIO_API_SECRET` | `SK…` + secret | API Key `SK53bc5edd…` («miguel», creada hoy) — **está en esta misma subcuenta**. Falta el secret en el `.env` |
| `TWILIO_CLIENT_ID` + `TWILIO_CLIENT_SECRET` | `OQ…` + `FK…` | app **OAuth de organización** (`ORc42536…`). Autentica pero **no tiene ningún permiso**: lo único que lee es `RoleAssignments`. Hoy no sirve para nada práctico |

Para tu tarea: usá `AC…`+token. Para código que se despliegue, una **API Key restringida** — se revoca
sin tocar la cuenta. La `SK53bc…` que creaste puede haber quedado con 0 permisos; se editan en la consola.

⚠ El **truco más útil**: cuando Twilio te da 401, **el mensaje dice el nombre exacto del permiso que
falta** (`twilio/messaging/content-templates/list`). Es la forma de saber qué marcar sin adivinar:
`./probe.py <url>`.

## 3. El modelo mental: cuatro objetos

    Sender (XE…)          el número de WhatsApp + su WhatsApp Business Account.  ✅ ya lo tenés
      │
    Content template (HX…)  el mensaje reusable, con variables {{1}} y uno o más "types"
      │
    Approval request      Meta lo aprueba (o lo rechaza). Sin esto no podés INICIAR conversación
      │
    Messaging Service (MG…)  OPCIONAL: agrupa senders y config. Podés mandar con From= directo

⚠ **Y la regla que ahorra trabajo:** si la persona te escribió en las últimas **24 h**, le contestás
con **texto libre, sin template**. Los templates son para **iniciar** la conversación vos.

## 4. Tus opciones: los `types` del template

Un template declara uno o varios `types`; Twilio elige el mejor según el canal (así el mismo template
degrada a texto en SMS). Del modelo de la Content API:

| type | qué le llega al cliente | límites de WhatsApp |
|---|---|---|
| `twilio/text` | texto con variables | el más simple, el que casi siempre alcanza |
| `twilio/media` | texto + imagen / PDF / video | 1 adjunto |
| `twilio/quick-reply` | botones que el cliente **toca y te responden** un payload | hasta 3 botones |
| `twilio/call-to-action` | botones que **abren una URL** o llaman | hasta 2 |
| `twilio/list-picker` | menú desplegable de opciones | hasta 10 ítems |
| `twilio/card` | header + cuerpo + media + botones | rich |
| `twilio/carousel` | varias cards deslizables | |
| `whatsapp/authentication` | **el de OTP**, con botón «copiar código» | va con categoría AUTHENTICATION |
| `twilio/location`, `twilio/catalog`, `twilio/flows` | punto en el mapa, catálogo, WhatsApp Flows | |

Y la **categoría**, que se elige al pedir aprobación. Es la causa nº 1 de rechazo:

- **AUTHENTICATION** — sólo OTP / códigos. Aprobación rápida, formato rígido.
- **UTILITY** — transaccional: comprobante de pago, cambio de fecha de cuota, estado de solicitud.
  **Acá cae casi todo lo de un flujo de crédito.**
- **MARKETING** — promociones. Más caro, más rechazo, y el cliente puede darse de baja.

Reglas de variables que Meta rechaza si las rompés: no arrancar ni terminar el cuerpo con una
variable, no poner dos variables pegadas, y nada de saltos de línea dentro del valor.

## 4b. Los types, medidos contra la API (2026-08-26)

Los campos obligatorios salen de mandarle **el objeto vacío** (`"types":{"twilio/carousel":{}}`):
el validador contesta enumerando lo que no puede ser nulo. Más rápido y más confiable que la doc.

| type | obligatorios | trampa medida |
|---|---|---|
| `twilio/text` | `body` | — |
| `twilio/media` | `media` | la URL debe ser pública: Meta la descarga al revisar |
| `twilio/location` | `latitude`, `longitude` | ⛔ **no elegible para aprobación de WhatsApp** (ver abajo) |
| `twilio/call-to-action` | `body` + `actions` (`URL`/`PHONE_NUMBER`) | — |
| `twilio/quick-reply` | `body`, `actions` | la respuesta vuelve como mensaje entrante: **sin webhook se pierde** |
| `twilio/list-picker` | `body`, `button`, `items` | ⛔ **no elegible para aprobación de WhatsApp** (ver abajo) + necesita webhook |
| `twilio/card` | al menos uno de `title`/`body`/`media` | ⚠ **`subtitle` no admite variables** («Subtitle cannot contain variables») |
| `twilio/carousel` | `body`, `cards`; cada card: `body`, `media`, `actions` | ⚠ en la card, **`media` va como STRING, no array** (al revés que en `twilio/media`), y hacen falta **≥2 cards**. Con el array puesto la API sólo dice «Request input may be invalid» sin nombrar el campo |
| `twilio/catalog` | `body` | acepta el template aunque no haya catálogo en Meta Commerce: falla recién al enviar |
| `whatsapp/card` | `body`, `header_text`, `footer`, `actions` (aceptados) | — |
| `whatsapp/authentication` | `add_security_recommendation`, `code_expiration_minutes`, acción `COPY_CODE` | obliga categoría `AUTHENTICATION`; el cuerpo lo fija WhatsApp |
| `twilio/flows` | `body`, `buttonText`, `type`, `pages[{id,title,layout}]` | ❌ **no salió a mano**: `layout` es el JSON de WhatsApp Flows y ningún `type` probado (`flow`/`navigate`/`data_exchange`) pasó. Armarlo en el editor de la consola |

### ⛔ Dos types NO se pueden aprobar — medido el 2026-08-26

Al pedir aprobación, Twilio rechaza con:

    Richest content type on template, twilio/list-picker, is not eligible for WhatsApp approval
    Richest content type on template, twilio/location,    is not eligible for WhatsApp approval

**Consecuencia práctica, que no es obvia:** el menú de lista y la ubicación **no sirven para
iniciar** una conversación. Sólo se pueden mandar **dentro de la ventana de 24 h**, como respuesta
a alguien que te escribió primero. Son herramientas de **soporte**, no de **alcance**.

Los otros 7 sí entraron a revisión: `twilio/text`, `twilio/media`, `twilio/call-to-action`,
`twilio/quick-reply`, `twilio/card`, `twilio/carousel`, `whatsapp/card`,
`whatsapp/authentication`.

### Lo que enseñó someter los 9 (2026-08-26)

**1 · El tipo y la categoría NO son independientes.** El carrusel rechazado como UTILITY, con
motivo textual de Meta:

    Carousel is not supported on template with `UTILITY` category

O sea que un carrusel **obliga** MARKETING — más caro, y el cliente puede darse de baja. Eso
cambia el cálculo de negocio: ofrecer planes de pago en carrusel no es una decisión de diseño,
es aceptar tarifa de marketing.

**2 · Un template sometido NO se puede volver a someter. Nunca.** Ni cambiándole la categoría, ni
con otro nombre:

    The template associated with this SID has already been submitted for approval.
    Please recreate a new template to make any changes.

El `HX` queda congelado en el primer envío, aprobado o rechazado. **Versionar = crear un template
nuevo**, y por eso la versión va en el nombre (`_v1`, `_v2`).

**3 · Aprobado no es enviable.** `twilio/catalog` se aprobó como MARKETING y el envío **falló con
error 63013**. No hay catálogo cargado en Meta Commerce, que es la explicación más plausible
(no comprobada). La lección general: la aprobación valida el *formato*, no que el canal esté
configurado para entregarlo.

**4 · Aprobación medida, de más rápido a más lento:** `AUTHENTICATION` y `MARKETING` resolvieron en
minutos; los `UTILITY` de tipos ricos tardaron más. Los dos `twilio/text`/`call-to-action` de la
tarea real se aprobaron y llegaron al teléfono en estado `read`.

**5 · El estado puede ir PARA ATRÁS: `approved` → `rejected`.** El template de OTP se aprobó, se
envió, llegó `delivered`… y después Meta lo dio vuelta a `rejected` con:

    There is already Spanish content for this template. You can create a new template and try again.

**No trates `approved` como final.** Si un envío empieza a fallar sin que hayas tocado nada,
revisá el estado del template antes de buscar el problema en tu código.

**6 · Ante un conflicto de nombre, la solución es una plantilla NUEVA — no cambiar el idioma.**
Probado con un A/B: se recrearon dos OTP idénticos que sólo diferían en `language` (`es` y `en`),
ambos con nombre nuevo. **Los dos se aprobaron**, el español incluido. Así que la causa era el
nombre ya registrado, y no —como se sospechó primero— que la WABA compartida con producción ya
tuviera un OTP en español. La hipótesis quedó refutada por la medición.

**7 · Meta te CAMBIA la categoría sin avisar.** `demo_twilio_quick_reply` se sometió como
`UTILITY` y volvió **aprobado como `MARKETING`**. El estado dice `approved`, así que nada parece
mal: sólo cambió el precio y el hecho de que el cliente pueda darse de baja. Comparación medida:

| template | pedí | quedó |
|---|---|---|
| `demo_twilio_card` | UTILITY | UTILITY |
| `demo_whatsapp_card` | UTILITY | UTILITY |
| `demo_twilio_quick_reply` | UTILITY | ⚠ **MARKETING** |

**Después de aprobar, comparás la categoría final con la que pediste** — si no, el costo se te
mueve por debajo. El campo está en `approval_requests.category` de
`GET /v1/ContentAndApprovals`.

### Resultado final del experimento (11 types, 2026-08-26)

| type | categoría final | resultado |
|---|---|---|
| `twilio/text` | UTILITY | ✅ aprobado · entregado |
| `twilio/call-to-action` | UTILITY | ✅ aprobado · entregado |
| `twilio/media` | UTILITY | ✅ aprobado · entregado |
| `twilio/card` | UTILITY | ✅ aprobado · entregado |
| `whatsapp/card` | UTILITY | ✅ aprobado · entregado |
| `whatsapp/authentication` | AUTHENTICATION | ✅ aprobado · entregado (a la segunda: nombre nuevo) |
| `twilio/quick-reply` | ⚠ MARKETING (pedí UTILITY) | ✅ aprobado · entregado |
| `twilio/carousel` | **MARKETING obligatorio** | ✅ aprobado · entregado (a la segunda: UTILITY lo rechaza) |
| `twilio/catalog` | MARKETING | ⚠ aprobado pero **el envío falla** (63013) |
| `twilio/list-picker` | — | ⛔ no elegible: sólo dentro de 24 h |
| `twilio/location` | — | ⛔ no elegible: sólo dentro de 24 h |

⚠ Los **límites de cantidad** (3 quick-replies, 2 call-to-action, 10 ítems de lista) son de la
plataforma de WhatsApp y **no se midieron acá**.

Catálogo visual con cómo se ve cada uno: el artifact «Burbujas de WhatsApp».

## 5. Crearlo: cuatro llamadas

Con `set -a && . ./.env && set +a` y `AUTH="$TWILIO_SID:$TWILIO_TOKEN"`.

**1) crear el template** (queda en borrador, reversible con `DELETE`)

    curl -X POST https://content.twilio.com/v1/Content -u "$AUTH" \
      -H 'Content-Type: application/json' -d '{
        "friendly_name": "pago_recibido_v1",
        "language": "es",
        "variables": {"1": "Miguel", "2": "$150.000"},
        "types": {"twilio/text": {"body": "Hola {{1}}, registramos tu pago de {{2}}. ¡Gracias!"}}
      }'

Devuelve el `sid` `HX…`. `variables` son valores de **ejemplo** para que Meta entienda el formato.

**2) mandarlo a aprobación de Meta** ⚠ este es el paso que sale de Twilio hacia afuera

    curl -X POST https://content.twilio.com/v1/Content/HX…/ApprovalRequests/whatsapp -u "$AUTH" \
      -H 'Content-Type: application/json' -d '{"name": "pago_recibido_v1", "category": "UTILITY"}'

El `name` va en minúsculas con guiones bajos y **no se puede cambiar** después: la versión va en el
nombre (`_v1`).

**3) ver en qué quedó** (`received` → `pending` → `approved` / `rejected`; minutos u horas)

    curl -s -u "$AUTH" https://content.twilio.com/v1/Content/HX…/ApprovalRequests
    curl -s -u "$AUTH" 'https://content.twilio.com/v1/ContentAndApprovals?PageSize=50'   # todos de una

**4) mandarlo** (⚠ esto sí cuesta plata y le llega a una persona real)

    curl -X POST "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_SID/Messages.json" -u "$AUTH" \
      -d "From=whatsapp:+573138591194" -d "To=whatsapp:+57<tu propio celular>" \
      -d "ContentSid=HX…" --data-urlencode 'ContentVariables={"1":"Miguel","2":"$150.000"}'

## 6. Por dónde empezar, en la práctica

1. **Primero en la consola**: Messaging → Content Template Builder. Armás uno a mano, ves cómo
   queda el JSON y qué valida Meta. Es la forma barata de entender el modelo.
2. Después el mismo por API, para que sea repetible.
3. Probá contra **tu propio celular** antes de cualquier cosa real.
4. Un template rechazado no cuesta plata, pero ensucia la reputación de la WABA: acertale a la
   categoría.

## 7. El sondeo

    ./probe.py            # app OAuth: identidad + qué permiso pediría cada producto
    ./probe.py <url>      # un GET puntual con el bearer del app OAuth
    ./probe.py key        # API Key (SK+secret): inventario de la cuenta
    ./probe.py key <url>  # un GET puntual con Basic auth

Para usarlo con las credenciales de cuenta en vez de la API Key:

    TWILIO_API_KEY="$TWILIO_SID" TWILIO_API_SECRET="$TWILIO_TOKEN" ./probe.py key

Dos trampas del endpoint de IAM que cuestan un rato: la ruta va **sin `/v1`**
(`preview-iam.twilio.com/Organizations/…`), y `Scope`/`Identity` quieren el **SID crudo** (`ORc425…`),
no el TRN (`trn:us1:iam:…`) → 400.
