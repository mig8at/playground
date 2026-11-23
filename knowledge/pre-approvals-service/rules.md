# Servicio de preaprobaciones: una puerta para todas las entidades

`pre-approvals-service` (Go) es la puerta única de las preaprobaciones del asistente: `POST /v1/preapprovals/check`
con la clave del producto (`lending_product_key`), el id de la entidad, el cliente, el comercio y la sucursal. No lista
ni ordena entidades y no tiene política de crédito: le pregunta a quien decide (la API de la entidad, o el motor de cupo
de legacy-backend para CreditopX) y traduce la respuesta a un formato común. Describe `pre-approvals-service` en `main`.

## Cada consulta vuelve a la entidad: no hay caché de preaprobaciones

`CheckPreApprovalUseCase::Execute` vuelve a consultar a la entidad en cada pedido. Lee la última fila guardada para esa
combinación (cliente, comercio, clave, entidad, sucursal), pero sólo para dos cosas:

- **Continuar una sesión pendiente:** si la última fila está `pending` (hoy sólo la emite Credifamilia), le pasa la
  respuesta anterior a la entidad, conserva el id y la fecha de creación, reemplaza la fila y suma la latencia hasta que
  la sesión llega a aprobada o rechazada.
- **Las entidades manuales (BCP consumo y vehicular):** si el pedido no trae una decisión nueva (`lender_decision`) y
  hay una fila previa que no es error, devuelve esa fila sin llamar a nadie. Es el único caso en que reusa.

Una fila de error nunca se toma como veredicto anterior. Las filas traen `expires_at` (el adaptador de CreditopX la pone
a 60 minutos), pero ese vencimiento no decide si se vuelve a consultar.

La consecuencia para quien llama desde el backend: pedir la misma preaprobación dos veces es evaluar dos veces. El plan
del riel 4 que lee la preaprobación del motor (`creditop_x_pre_approval`) hace que el motor vuelva a evaluar al cliente;
si entre la tarjeta y el plan cambió el cupo, el plan puede salir con otro monto.

## El flujo de cada entidad: credenciales, autenticación, llamada y adaptación

Cada clave tiene su cliente, su estrategia de autenticación y su adaptador, armados en `factory.go`: Bancolombia
(compra y paga después, y consumo), Sistecrédito, Meddipay, CreditopX, Welli, Prami, Credifamilia, BCP consumo y
vehicular, Crédito365 y Flamingo. `PreApprovalWorkflow` los corre en cuatro etapas: pide las credenciales, se autentica
(OAuth2, API key, token o nada), llama a la API y adapta la respuesta al formato común (aprobada, rechazada o pendiente,
con el monto aprobado y la respuesta cruda en `transaction_data`).

Reglas propias del servicio, antes o alrededor de esas etapas:

- **Alias de clave:** `Canonical()` traduce un alias a su clave base antes de validarla. En `main` el único alias es
  `credifamilia-materiales` → `credifamilia`. Una clave desconocida responde 400.
- **Welli:** las variantes 141 y 142 se consultan como la 23.
- **El perfil del cliente:** para toda clave salvo `creditop_x` lo pide a legacy-backend (`GET {user_service}/user/{id}`)
  y lo pasa a la entidad. El motor de CreditopX ya tiene al cliente y no lo necesita.
- **CreditopX:** llama a `POST /api/loans/lender/available-quota` de legacy-backend, sin autenticación. Es aprobada sólo
  si la respuesta trae `has_quota` y `status = approved`; el monto es `quota_details.max_requestable`.
- **Errores:** sólo Welli y Crédito365 guardan una fila de error con el pedido y la respuesta; las demás claves no
  guardan nada cuando la entidad falla.
- **El aviso del resultado a legacy-backend** (`lender-result`, para el perfilamiento) está apagado
  (`legacyLenderResultEnabled = false`).

## Lo que guarda: historia en DynamoDB y credenciales en memoria

Guarda en DynamoDB, no en MySQL:

| tabla | qué guarda |
|---|---|
| `preapprovals` | cada consulta: cliente, comercio, sucursal, clave, entidad, estado, monto pedido y aprobado, pedido y respuesta crudos, latencia y vencimiento |
| `preapproval_attempts` | qué solicitud consultó a qué entidad (`LENDER#<entidad>` / `REQUEST#<solicitud>`) |

Es historia y auditoría, no caché: ver la primera sección.

Las credenciales de cada entidad las pide a legacy-backend (`POST /api/onboarding/credentials/get-by-lender`, que las
devuelve descifradas) y las guarda en un mapa en memoria por clave, entidad, comercio y sucursal, sin vencimiento: duran
hasta que se reinicia la instancia. `ClearCache` y `ClearCacheForLender` existen pero nadie las llama, y la segunda borra
por el id de la entidad, que no es la clave con la que se guarda. Una credencial rotada en el admin no se ve hasta un
reinicio.
