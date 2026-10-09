# Twilio desde Claude: cómo conectarse y crear cosas

No hace falta ningún plugin ni MCP. Claude llama a la **API REST de Twilio** con `curl`, usando tus
credenciales en un `.env`. Pasale este archivo a Claude como contexto y pedile lo que quieras crear.

## 1. Credenciales

En la consola de Twilio (Account → API keys & tokens):

| opción | qué es | cuándo |
|---|---|---|
| **Account SID + Auth Token** (`AC…` + token) | acceso completo a la cuenta, lectura y escritura | lo más rápido para aprender |
| **API Key + Secret** (`SK…` + secret) | se revoca sin tocar la cuenta, se le restringen permisos | lo recomendable; el secret se muestra UNA sola vez |

Guardalas en un `.env` que no esté en git:

    TWILIO_SID=AC...
    TWILIO_TOKEN=...

y cargalas así: `set -a && . ./.env && set +a && AUTH="$TWILIO_SID:$TWILIO_TOKEN"`
(con API Key: `AUTH="$TWILIO_API_KEY:$TWILIO_API_SECRET"`, y el `AC…` igual hace falta en las URLs).

⚠ **En Twilio todo es POR CUENTA (y subcuenta).** Un template creado en una cuenta sólo existe ahí:
no lo ve la cuenta padre ni una hermana. Si el código que lo va a usar corre con otra cuenta, el envío
da «template not found». Confirmá en qué cuenta estás antes de crear.

⚠ **Truco:** cuando Twilio responde 401, el mensaje dice el **nombre exacto del permiso que falta**
(p. ej. `twilio/messaging/content-templates/list`). Así sabés qué marcar en una API Key restringida.

## 2. El modelo mental

    Sender (XE…)              el número de WhatsApp + su WhatsApp Business Account (WABA)
      │
    Content template (HX…)    el mensaje reusable, con variables {{1}} y uno o más "types"
      │
    Approval request          Meta lo aprueba o lo rechaza. Sin esto NO podés iniciar conversación
      │
    Messaging Service (MG…)   opcional: agrupa senders. Se puede mandar con From= directo

Si la persona te escribió en las **últimas 24 h**, le contestás con texto libre, sin template.
Los templates son para **iniciar** la conversación.

## 3. Crear y mandar un template: cuatro llamadas

**1) Crear el template** (queda en borrador; se borra con `DELETE`)

    curl -X POST https://content.twilio.com/v1/Content -u "$AUTH" \
      -H 'Content-Type: application/json' -d '{
        "friendly_name": "pago_recibido_v1",
        "language": "es",
        "variables": {"1": "Ana", "2": "$150.000"},
        "types": {"twilio/text": {"body": "Hola {{1}}, registramos tu pago de {{2}}. ¡Gracias!"}}
      }'

Devuelve el `sid` `HX…`. `variables` son valores de **ejemplo** para que Meta entienda el formato.

**2) Mandarlo a aprobación de Meta** (este paso sale de Twilio hacia Meta)

    curl -X POST https://content.twilio.com/v1/Content/HX.../ApprovalRequests/whatsapp -u "$AUTH" \
      -H 'Content-Type: application/json' -d '{"name": "pago_recibido_v1", "category": "UTILITY"}'

El `name` va en minúsculas con guiones bajos y no se puede cambiar: la versión va en el nombre.

**3) Ver en qué quedó** (`received` → `pending` → `approved` / `rejected`; minutos u horas)

    curl -s -u "$AUTH" https://content.twilio.com/v1/Content/HX.../ApprovalRequests
    curl -s -u "$AUTH" 'https://content.twilio.com/v1/ContentAndApprovals?PageSize=50'   # todos

**4) Mandarlo** (⚠ cuesta plata y le llega a una persona real: probá primero con tu celular)

    curl -X POST "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_SID/Messages.json" -u "$AUTH" \
      -d "From=whatsapp:+57<número del sender>" -d "To=whatsapp:+57<tu celular>" \
      -d "ContentSid=HX..." --data-urlencode 'ContentVariables={"1":"Ana","2":"$150.000"}'

Para ver qué hay en la cuenta (sólo lectura):

    curl -s -u "$AUTH" "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_SID.json"
    curl -s -u "$AUTH" https://messaging.twilio.com/v2/Channels/Senders     # senders de WhatsApp
    curl -s -u "$AUTH" https://messaging.twilio.com/v1/Services             # messaging services

## 4. Categorías

- **AUTHENTICATION**: sólo OTP / códigos. Aprobación rápida, formato rígido.
- **UTILITY**: transaccional (pago recibido, estado de solicitud, cambio de cuota). Acá cae casi todo
  lo de un flujo de crédito.
- **MARKETING**: promociones. Más caro, más rechazo, y el cliente puede darse de baja.

Meta rechaza si: el cuerpo arranca o termina con una variable, hay dos variables pegadas, o un valor
trae saltos de línea.

## 5. Los types, medidos contra la API

Truco: mandá el type con **el objeto vacío** (`"types":{"twilio/carousel":{}}`) y el validador
te enumera los campos obligatorios. Más rápido y confiable que la documentación.

| type | obligatorios | resultado / trampa |
|---|---|---|
| `twilio/text` | `body` | ✅ aprobado (UTILITY) y entregado |
| `twilio/media` | `media` | ✅ · la URL debe ser pública: Meta la descarga al revisar |
| `twilio/call-to-action` | `body`, `actions` (`URL`/`PHONE_NUMBER`) | ✅ UTILITY |
| `twilio/quick-reply` | `body`, `actions` | ✅ pero Meta lo pasó a **MARKETING** (pedido como UTILITY). La respuesta llega como mensaje entrante: sin webhook se pierde |
| `twilio/card` | al menos uno de `title`/`body`/`media` | ✅ UTILITY · `subtitle` **no admite variables** |
| `whatsapp/card` | `body`, `header_text`, `footer`, `actions` | ✅ UTILITY |
| `whatsapp/authentication` | `add_security_recommendation`, `code_expiration_minutes`, acción `COPY_CODE` | ✅ obliga categoría AUTHENTICATION |
| `twilio/carousel` | `body`, `cards` (≥2); cada card `body`, `media`, `actions` | ✅ **sólo como MARKETING** (UTILITY lo rechaza). En la card, `media` va como **string, no array** |
| `twilio/catalog` | `body` | ⚠ se aprueba, pero el envío falla (error 63013) si no hay catálogo en Meta Commerce |
| `twilio/list-picker` | `body`, `button`, `items` | ⛔ **no se puede aprobar**: sólo dentro de la ventana de 24 h |
| `twilio/location` | `latitude`, `longitude` | ⛔ **no se puede aprobar**: sólo dentro de la ventana de 24 h |
| `twilio/flows` | `body`, `buttonText`, `type`, `pages[{id,title,layout}]` | ❌ no salió a mano: armarlo en el editor de la consola |

## 6. Reglas de aprobación que no están en la documentación

1. **Un template sometido no se puede volver a someter nunca**, ni con otra categoría ni con otro
   nombre («Please recreate a new template»). Para cambiarlo: template nuevo, con `_v2` en el nombre.
2. **El tipo y la categoría están acoplados**: un carrusel obliga MARKETING.
3. **Meta cambia la categoría sin avisar**: el estado dice `approved` pero cambió el precio. Después de
   aprobar, compará `approval_requests.category` (en `ContentAndApprovals`) con la que pediste.
4. **`approved` no es final**: un template aprobado y entregado puede pasar a `rejected` después. Si un
   envío empieza a fallar sin que toques nada, revisá el template antes que el código.
5. **Conflicto de nombre** («There is already Spanish content for this template»): la solución es un
   template con nombre nuevo, no cambiar el idioma.
6. **Aprobado no es enviable**: la aprobación valida el formato, no que el canal esté configurado.

## 7. Para recibir mensajes (webhook)

Cuando la persona responde, Twilio hace un POST a la URL que configures en el sender. Tres cosas
obligatorias:

1. **Verificar `X-Twilio-Signature`** en cada request; si no valida, 403. Sin eso cualquiera postea.
2. **Idempotencia por `MessageSid`**: Twilio reintenta ante error o timeout.
3. **Responder 200 rápido** y hacer el trabajo aparte.

## 8. Cómo pedírselo a Claude

> «Tengo credenciales de Twilio en `.env` (`TWILIO_SID`, `TWILIO_TOKEN`). Leé `twilio-para-santi.md`
> y creá un template `twilio/text` UTILITY llamado `xxx_v1` con este texto: … Mostrame el JSON antes
> de crearlo y no lo mandes a aprobación ni envíes nada sin preguntarme.»

Pedile que confirme antes de los pasos 2 y 4: son los que salen hacia Meta o hacia una persona.
