# Canal de soporte por WhatsApp — endpoints

Todo lo que el bot necesita llamar, ya desplegado y andando en **develop**. Son 16 rutas: 8 para que el
cliente se autogestione y 8 para el flujo del asesor (5 se comparten). La conversación es tuya; el
estado de autorización y la escritura del dato son del backend.

| | |
|---|---|
| **Base (dev)** | `https://api.dev.creditop.com/legacy-api/support` |
| **Auth** | `Authorization: Bearer <token>` |
| **Token** | te lo paso aparte |
| **Formato** | JSON · `Accept: application/json` |

Estado al 21 de agosto de 2026. El módulo (`Modules/SupportBot` en `legacy-backend`) está mergeado a
`develop` y a `staging`, y las 16 rutas están expuestas en el API Gateway de dev.

---

## 1 · Lo que aplica a todas

| Regla | Detalle |
|---|---|
| **Dos cabeceras, siempre** | `Authorization: Bearer <token>` y `Accept: application/json`. Sin `Accept`, algunos errores de validación salen como HTML en vez de JSON. |
| **El `wa` va en TODAS** | Es el número de WhatsApp de quien está hablando, con el formato de Twilio: `whatsapp:+573001234567`. En los `GET` va como query (url-encoded), en los `POST`/`PATCH` va en el cuerpo. Es lo que resuelve la sesión: sin él no hay identidad. |
| **Respuesta OK** | `{ "success": true, "message": "…", "data": { … } }` |
| **Respuesta con error** | `{ "success": false, "message": "…", "errors": { "error_code": "…" } }` — **ramificá por `errors.error_code`**, nunca por el texto: el texto cambia. |
| **La sesión** | Dura **15 minutos** desde la última actividad y admite **3 intentos** de código. Estados: `anonymous → identified → otp_sent → otp_verified → expired`. No se puede volver atrás desde `otp_verified`. |
| **Una sesión por número** | Y por actor. La sesión del asesor no sirve para las rutas del cliente ni al revés: da `409 WRONG_ACTOR`. |
| **El `otp_id` nunca sale** | No lo pidas ni lo mandes. El backend lo guarda en la sesión y lo usa solo al escribir: es la prueba de que el dueño del dato autorizó. |

> ⚠ **401 vs 503.** `401 UNAUTHORIZED` = el token está mal o falta. `503 CHANNEL_NOT_CONFIGURED` = el
> canal no tiene token configurado del lado nuestro (problema de despliegue, no tuyo). Los dos merecen el
> mismo mensaje al usuario —«tengo un problema técnico»— y una alerta distinta para nosotros.

---

## 2 · Flujo del cliente — se autogestiona solo

El cliente escribe desde su celular y cambia **fecha de pago** o **plazo**. No hay tercero: el número
desde el que escribe es el primer factor, la cédula el segundo y el código el tercero. Es el flujo más
corto y el que ya está probado punta a punta contra dev.

1. `GET /self/by-phone` — ¿de quién es este número? (opcional, sirve para saludar por el nombre)
2. `POST /self/otp` — número + cédula, y sale el código
3. `POST /self/otp/verify` — abre la sesión y **devuelve los créditos gestionables**
4. `GET /credits/{id}/can-change` — ¿este crédito admite cambios hoy?
5. `GET /credits/{id}/payment-date-options` o `/fee-number-options` — el menú
6. `POST /credits/{id}/change-payment-date` o `/change-fee-number` — escribe

### 1 · `GET /self/by-phone?wa=`

Resuelve al cliente por el número de WhatsApp. No abre sesión ni manda nada: sirve para saber si el
número está registrado y saludar por el nombre.

```bash
curl -s "$BASE/self/by-phone?wa=whatsapp%3A%2B573109000004" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "success": true,
  "message": "success",
  "data": {
    "user_id": 1827797,
    "document_number": "3767****195",
    "first_name": "QA"
  }
}
```

**404 `CLIENT_NOT_FOUND`** si el número no es de ningún cliente. La cédula viene enmascarada a
propósito: todavía nadie probó ser quien dice.

### 2 · `POST /self/otp`

Manda el código por **SMS** al celular del crédito — nunca por el WhatsApp de la conversación. Pide las
dos cosas juntas: el número y la cédula.

| campo | | qué es |
|---|---|---|
| `wa` | obligatorio | string, máx. 32 · `whatsapp:+57…` |
| `document` | obligatorio | string, máx. 32 · la cédula tal como la tipeó |

```bash
curl -s -X POST "$BASE/self/otp" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"wa":"whatsapp:+573109000004","document":"37670195"}'
```

```json
{
  "success": true,
  "message": "Código enviado.",
  "data": {
    "state": "otp_sent",
    "sent_to": "310***0004",
    "expires_in_minutes": 15,
    "attempts_allowed": 3
  }
}
```

> **Puede volver ya verificado.** Si la sesión sigue viva (15 min) responde `200` con
> `"already_verified": true`, `state: "otp_verified"` y directamente los `operable_credits`.
> **No pidas el código en ese caso**: seguí al menú de créditos. Pasa siempre que alguien hace dos
> cambios seguidos.

**404 `CLIENT_NOT_FOUND`** tanto si el número no existe como si la cédula no coincide — es el mismo
cuerpo a propósito. Para el usuario: «esos datos no coinciden, revisá la cédula».

### 3 · `POST /self/otp/verify`

Valida el código, abre la sesión y —lo importante— **devuelve los créditos sobre los que se puede
operar**. Es la única forma de saber qué `user_request_id` usar después.

| campo | | qué es |
|---|---|---|
| `wa` | obligatorio | el mismo de arriba |
| `code` | obligatorio | string de 4 a 8 dígitos |

```json
{
  "success": true,
  "message": "Identidad verificada.",
  "data": {
    "state": "otp_verified",
    "user_id": 1827797,
    "expires_in_minutes": 15,
    "operable_credits": [
      { "user_request_id": 223999, "merchant": "Mediarte",    "lender": "Creditop",
        "next_payment_date": "2025-07-16", "installment_value": 145000.0,
        "installment_number": 3, "fee_number": 6 },
      { "user_request_id": 126135, "merchant": "CeluRD Test", "lender": "Creditop",
        "next_payment_date": "2026-01-16", "installment_value": 98000.0,
        "installment_number": 3, "fee_number": 9 }
    ],
    "operable_truncated": false
  }
}
```

- **Vienen *datos*, no texto armado.** El título y el subtítulo de cada fila los componés vos, porque los
  límites de la lista de WhatsApp (24 y 72 caracteres) son del canal. Lo que la persona reconoce es el
  **comercio** y la **fecha**, no el id.
- **Normalmente viene uno solo** → no preguntes nada. Si vienen varios, ahí sí hay menú.
- `operable_truncated: true` significa que hay más de 4 y se recortaron: mandá a la persona con un asesor
  en vez de esconderle un crédito.
- **422 `OTP_INVALID`** trae `attempts_left` — decíselo. En 0 pasa a `OTP_ATTEMPTS_EXCEEDED` y hay que
  pedir un código nuevo (volver al paso 2).

### 4 · `GET /credits/{user_request_id}/can-change?wa=`

¿Este crédito admite cambios hoy? Preguntalo antes de ofrecer el menú.

```json
{ "success": true, "message": "success",
  "data": { "can_change": true, "reason": null, "message": null } }
```

```json
{ "success": true, "message": "success",
  "data": { "can_change": false,
            "reason": "HAS_PENDING_PAYMENT",
            "message": "No puedes cambiar el plazo…" } }
```

Ojo: acá el «no» viene con `200` y `can_change: false`. Los motivos posibles están en la tabla de
códigos, más abajo.

### 5a · `GET /credits/{user_request_id}/payment-date-options?wa=`

Las **dos** próximas fechas de los ciclos fijos (5, 16 y 28). Vienen con la etiqueta ya escrita en
español.

```json
{
  "success": true, "message": "success",
  "data": {
    "current_payment_date": "2026-01-16",
    "options": [
      { "value": "2026-01-28", "label": "28 de enero de 2026" },
      { "value": "2026-02-05", "label": "5 de febrero de 2026" }
    ]
  }
}
```

Si el crédito no admite cambios devuelve **422** con el mismo `error_code` que `can-change` — no un 200
con lista vacía.

### 5b · `GET /credits/{user_request_id}/fee-number-options?wa=`

Los plazos alternativos con su cuota simulada.

```json
{
  "success": true, "message": "success",
  "data": {
    "options": [
      { "fee_number": 9,  "fee_value": 238450.11, "total_amount": 1669150.77,
        "is_available": true, "is_current": false },
      { "fee_number": 12, "fee_value": 186320.40, "total_amount": 1863204.00,
        "is_available": true, "is_current": false }
    ],
    "has_options": true
  }
}
```

> ⚠ **Puede venir vacío con `can_change: true`, y no es un bug.** Son dos preguntas distintas: el crédito
> admite cambios, pero su categoría descarta todos los plazos. En ese caso **la fecha sí se puede
> cambiar** — no digas «no se puede», ofrecé la fecha. Filtrá siempre por `is_available: true` antes de
> pintar el menú.

### 6a · `POST /credits/{user_request_id}/change-payment-date`

Escribe. Exige sesión `otp_verified` y que el crédito sea de esa persona.

```json
{
  "wa": "whatsapp:+573109000004",
  "selected_payment_date": "2026-01-28"
}
```

`selected_payment_date` es exactamente el `value` de una opción: formato `AAAA-MM-DD`, de hoy en
adelante.

```json
{
  "success": true,
  "message": "Cambio aplicado.",
  "data": {
    "old_date": "2026-01-16",
    "new_date": "2026-01-28",
    "history_id": 552104,
    "user_id": 1827797
  }
}
```

### 6b · `POST /credits/{user_request_id}/change-fee-number`

```json
{
  "wa": "whatsapp:+573109000004",
  "selected_fee": { "fee_number": 9 }
}
```

**Solo el número de cuotas.** Si mandás `fee_value` se ignora: el monto lo pone el backend desde lo que
él mismo ofreció.

```json
{
  "success": true,
  "message": "Cambio aplicado.",
  "data": {
    "old_fee_number": 6,
    "new_fee_number": 9,
    "new_fee_value": 238450.11,
    "history_id": 552105
  }
}
```

**422 `FEE_NOT_AVAILABLE`** si el plazo no está entre los que el canal ofreció. **422
`CHANGE_NOT_ALLOWED`** si dejó de ser elegible entre que se mostró el menú y se confirmó.

---

## 3 · Flujo del asesor — pide uno, autoriza otro

El asesor pide el cambio y **el dato no se toca**. Después el cliente, en *su propia* conversación, se
identifica y autoriza. Recién ahí se escribe.

> 🔴 **Son dos conversaciones y lo único que las ata es el `request_id`.** No hay sesión compartida: el
> asesor tiene la suya, el cliente la suya, y el backend rechaza cruzarlas (`409 WRONG_ACTOR`). El chat
> del cliente **no existe hasta que el asesor crea la solicitud** —ese momento es el disparo hacia el
> otro chat— y el chat del asesor **termina esperando**: no puede seguir solo.

1. `POST /advisor/otp` — cédula del asesor; el código va al celular de **su perfil**
2. `POST /advisor/otp/verify` — abre su sesión
3. `GET /clients?document=` — busca al cliente, ya filtrado por sus comercios
4. `POST /change-requests` — crea la solicitud → **guardate el `request_id`**
5. ↯ **cambia de conversación** — el cliente se identifica con `/self/otp` + `/self/otp/verify` desde SU número
6. `PATCH /change-requests/{id}/authorize` — el cliente acepta la gestión
7. `POST /change-requests/{id}/confirm` — **acá se escribe**

### 1 · `POST /advisor/otp`

Cuerpo `{ wa, document }`, igual que el del cliente. La diferencia que importa: **el código va al celular
del perfil del asesor**, no al número desde el que escribe (un asesor puede escribir desde cualquier
teléfono).

```json
{ "success": true, "message": "Código enviado al celular de tu perfil.",
  "data": { "state": "otp_sent", "sent_to": "320***4567",
            "expires_in_minutes": 15, "attempts_allowed": 3 } }
```

**404 `ADVISOR_NOT_FOUND`** si la cédula no es de un asesor con comercios asignados ·
**409 `ADVISOR_WITHOUT_PHONE`** si su perfil no tiene celular (no hay a dónde mandar la prueba; que hable
con soporte).

### 2 · `POST /advisor/otp/verify`

Cuerpo `{ wa, code }`. Devuelve los comercios que maneja.

```json
{ "success": true, "message": "Identidad verificada.",
  "data": { "state": "otp_verified", "user_id": 40122,
            "allied_ids": [158, 204], "expires_in_minutes": 15 } }
```

### 3 · `GET /clients?wa=&document=`

Busca al cliente **solo dentro de los comercios del asesor**. Si el cliente existe pero no es suyo,
responde **exactamente lo mismo** que si no existiera (`404 CLIENT_NOT_FOUND`) — es deliberado, para que
el buscador no sirva para averiguar qué cédulas están en la base.

```json
{
  "success": true, "message": "success",
  "data": {
    "user_id": 1827797,
    "first_name": "ANA", "surname": "QA",
    "document_number": "9000****001",
    "cell_phone": "310***0011",
    "operable_credits": [ { "user_request_id": 223999, "merchant": "Mediarte", "…": "…" } ]
  }
}
```

`operable_credits` tiene **la misma forma** que en autogestión: armás el menú igual venga de donde venga.

### 4 · `POST /change-requests`

Crea la solicitud en `pendiente_autorizacion`. **No escribe el dato.** Devuelve `201`.

| campo | | qué es |
|---|---|---|
| `wa` | obligatorio | el del **asesor** |
| `document` | obligatorio | la cédula del cliente (se vuelve a filtrar por comercio acá) |
| `field` | obligatorio | `cell_phone` · `next_payment_date` · `fee_number`. Nada más |
| `new_value` | obligatorio | según el campo: 10 dígitos · `AAAA-MM-DD` de hoy en adelante · entero ≥ 1 |
| `user_request_id` | condicional | **obligatorio si `field` es del crédito** (`next_payment_date` o `fee_number`); no va para `cell_phone` |
| `old_value` | opcional | el valor anterior, para mostrárselo al cliente |

```json
{
  "wa": "whatsapp:+573201234567",
  "document": "900000001",
  "field": "next_payment_date",
  "new_value": "2026-02-05",
  "user_request_id": 223999
}
```

```json
{
  "success": true,
  "message": "Solicitud creada. Falta que el cliente la autorice.",
  "data": {
    "request_id": 184,
    "field": "next_payment_date",
    "status": "pendiente_autorizacion",
    "old_value": "2026-01-16",
    "new_value": "2026-02-05",
    "requested_by": "Carolina"
  }
}
```

**Guardá `request_id`**: es lo único que ata las dos conversaciones. Si se pierde, el cambio queda
colgado sin forma de retomarlo.

### 5 · `PATCH /change-requests/{id}/authorize`

Cuerpo `{ wa }` — el del **cliente**, con su sesión ya verificada (pasos `/self/otp` +
`/self/otp/verify` en su propio chat). Pasa la solicitud a `autorizada`. Todavía no escribe nada.

```json
{ "success": true, "message": "Autorizada. Te enviamos un código para confirmar.",
  "data": { "request_id": 184, "field": "next_payment_date", "status": "autorizada",
            "old_value": "2026-01-16", "new_value": "2026-02-05", "requested_by": "Carolina" } }
```

Si la solicitud no es de esa persona: **404 `CHANGE_REQUEST_NOT_FOUND`** (no 403, para no confirmar que
el id existe).

### 6 · `POST /change-requests/{id}/confirm`

Cuerpo `{ wa }` — el del cliente. **Acá sí escribe**, en la misma transacción que el registro de
auditoría, usando el `otp_id` de la verificación de identidad. Pasa a `aplicada`.

```json
{ "success": true, "message": "Cambio aplicado.",
  "data": { "request_id": 184, "status": "aplicada", "…": "…" } }
```

**409 `OTP_NOT_VERIFIED`** si la sesión del cliente no está verificada · **409 `INVALID_REQUEST_STATE`**
si la solicitud no está en `autorizada` (trae el `status` real).

### 7 · `PATCH /change-requests/{id}/reject`

Cuerpo `{ wa, reason }`. `reason` admite exactamente dos valores, y la diferencia importa:

| `reason` | qué pasa |
|---|---|
| `rechazado_por_cliente` | queda `rechazada`. Cambió de opinión, nada más |
| `no_reconocido` | queda **`bloqueada`** y marcada para escalar. Es «no fui yo»: alguien pidió un cambio que el cliente no reconoce |

Dale una salida visible al «no fui yo» en la conversación — es la señal que hoy nadie puede ver.

### ✗ `POST /change-requests/{id}/otp` — existe pero no la llames

Es inalcanzable por diseño: para llegar ahí la sesión ya está en `otp_verified`, y la máquina de estados
no permite volver a `otp_sent`. Siempre responde `409 INVALID_STATE`. `confirm` no la necesita — va
directo de `authorize` a `confirm`. Queda listada para que no la busques cuando veas 16 rutas y uses 15.

---

## 4 · Códigos de error

Todos vienen en `errors.error_code`. Ramificá por acá.

| `error_code` | HTTP | qué pasó · qué hacer |
|---|---|---|
| `UNAUTHORIZED` | 401 | token mal o ausente. Problema de config, no del usuario |
| `CHANNEL_NOT_CONFIGURED` | 503 | el canal quedó sin token del lado nuestro. Avisanos |
| `VALIDATION_FAILED` | 422 | falta un campo o viene mal. El detalle por campo va en el mismo `errors` |
| `CLIENT_NOT_FOUND` | 404 | número o cédula que no resuelven a un cliente (mismo cuerpo para los dos casos) |
| `ADVISOR_NOT_FOUND` | 404 | la cédula no es de un asesor con comercios |
| `ADVISOR_WITHOUT_PHONE` | 409 | su perfil no tiene celular: no hay a dónde mandar el código |
| `SESSION_NOT_FOUND` | 409 | la sesión venció (15 min). Volvé a empezar desde el OTP |
| `NOT_VERIFIED` | 409 | hay sesión pero sin código verificado. Trae el `state` |
| `WRONG_ACTOR` | 409 | usaste una sesión de asesor en una ruta de cliente o al revés |
| `NO_OTP_PENDING` | 409 | no hay código para validar. Pedí uno nuevo |
| `INVALID_STATE` | 409 | transición de sesión no permitida. Trae el `state` de origen |
| `OTP_INVALID` | 422 | código errado. Trae `attempts_left` |
| `OTP_ATTEMPTS_EXCEEDED` | 422 | se acabaron los 3 intentos. Hay que emitir otro código |
| `OTP_SEND_FAILED` | 502 | el proveedor de SMS falló. Reintentable |
| `OTP_NOT_VERIFIED` | 409 | se intentó escribir sin código verificado |
| `CREDIT_NOT_FOUND` | 404 | el crédito no existe o no es de esa persona |
| `CREDIT_NOT_SERVICED_BY_US` | 422 | ese crédito lo administra la entidad que lo otorgó. No se toca desde acá |
| `CHANGE_NOT_ALLOWED` | 422 | dejó de ser elegible entre el menú y la confirmación |
| `FEE_NOT_AVAILABLE` | 422 | ese plazo no estaba entre los ofrecidos |
| `CHANGE_REQUEST_NOT_FOUND` | 404 | la solicitud no existe o no es de esa persona |
| `INVALID_REQUEST_STATE` | 409 | la solicitud no está en el estado que ese paso pide. Trae el `status` |

Y los que salen dentro de `can-change` (con `200` y `can_change: false`, o como `422` en los endpoints de
opciones):

| `reason` | qué decirle al cliente |
|---|---|
| `HAS_PENDING_PAYMENT` | tiene una cuota por pagar. Es lo más frecuente |
| `RECENT_CHANGE_EXISTS` | ya hizo un cambio: solo uno cada **6 meses** |
| `NO_ACTIVE_CREDIT` | no hay crédito activo en esa solicitud |
| `EXTERNALLY_SERVICED` | el crédito lo gestiona la entidad, no nosotros |
| `USER_REQUEST_NOT_FOUND` | no existe la solicitud |

> ⚠ **El copy de `HAS_PENDING_PAYMENT` dice «no puedes cambiar el plazo»** aunque se esté pidiendo la
> fecha — es un texto compartido con la app y todavía no lo arreglamos. Redactalo vos, no lo muestres tal
> cual.

---

## 5 · Cinco cosas que te van a morder

- **Solo créditos que operamos nosotros.** Los que vienen en `operable_credits` están filtrados, pero el
  `user_request_id` va en la URL: si mandás uno que no estaba en la lista, responde
  `422 CREDIT_NOT_SERVICED_BY_US`. Nunca armes ese id vos.
- **Un cambio cada 6 meses.** Después de un cambio exitoso, ese crédito queda bloqueado y `can-change`
  pasa a `false` con `RECENT_CHANGE_EXISTS`. Para volver a probar el mismo caso hay que resetear la data
  — pedime el script.
- **La sesión son 15 minutos.** Una conversación que se enfría vuelve con `409 SESSION_NOT_FOUND` en el
  próximo paso: manejalo como «se me venció, empecemos de nuevo» y no como error técnico.
- **El OTP sale por SMS, nunca por WhatsApp.** Si el código viajara por el mismo canal de la conversación
  dejaría de ser segundo factor. No lo pidas por otra vía ni lo repitas en el chat.
- **El estado de la conversación es tuyo; el de la autorización es nuestro.** Qué menú mostraste, qué
  eligió y cómo repreguntar: n8n. Si se identificó, si el código se verificó y cuántos intentos quedan:
  backend. No guardes «ya lo validé» de tu lado — el backend no te lo va a creer, y está bien que no.

---

## 6 · Para probar hoy mismo

El canal está vivo en dev. Con el token puesto, esto tiene que devolverte `200`:

```bash
BASE=https://api.dev.creditop.com/legacy-api/support
TOKEN=<el token que te pasé>

curl -s "$BASE/self/by-phone?wa=whatsapp%3A%2B573109000004" \
  -H "Accept: application/json" -H "Authorization: Bearer $TOKEN"

# → {"success":true,"message":"success","data":{"user_id":1827797,
#      "document_number":"3767****195","first_name":"QA"}}
```

| Usuario de prueba (dev) | `wa` | cédula | sirve para |
|---|---|---|---|
| QA | `whatsapp:+573109000004` | `37670195` | un crédito gestionable, camino completo |
| ANA QA | `whatsapp:+573108000011` | `900000001` | dos créditos en dos comercios: se ve el menú de elegir |

**El código de esos números no llega por SMS: son los últimos 4 dígitos del celular.** Están en la lista
de bypass de QA en dev, así que el proveedor no se llama. Para `+573109000004` el código es `0004`.

⚠ **Con cualquier otro número el SMS se manda de verdad.** Usá solo números propios o de esta lista.

**ANA QA hay que sembrarla** antes de usarla, y el script también sirve de reset (devuelve sus dos
créditos al estado inicial, que es lo que te deja probar muchas veces pese al bloqueo de 6 meses):
`agente-soporte-modificacion-datos.cliente-qa.casos.sql` — pedímelo.

Y hay un **prototipo navegable** que recorre el flujo del cliente pegándole a esta misma API, con la
respuesta de cada llamada al costado. Sirve para ver el orden real de las llamadas antes de escribir el
primer nodo.

---

*Los ejemplos de respuesta salen del código de cada controlador; `self/by-phone`, el `401` sin token y
los `409` de sesión se midieron contra dev el 21/8. Los valores (ids, montos, nombres de comercio) son
ilustrativos: lo que vale es la forma y el nombre de cada campo. Dudas del contrato → Miguel.*
