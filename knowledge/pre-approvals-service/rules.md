# Servicio de preaprobaciones: una puerta para todas las entidades

`pre-approvals-service` (Go) es la puerta única de las preaprobaciones del asistente: `POST /v1/preapprovals/check`
con la clave del producto (`lending_product_key`), el id de la entidad, el cliente, el comercio y la sucursal. No lista
ni ordena entidades y no tiene política de crédito: le pregunta a quien decide (la API de la entidad, o el motor de cupo
de legacy-backend para CreditopX) y traduce la respuesta a un formato común. Describe `pre-approvals-service` en `main`.

## Cada consulta vuelve a la entidad: no hay caché de preaprobaciones

`CheckPreApprovalUseCase::Execute` vuelve a consultar a la entidad en cada pedido. Lee la última fila guardada en
`preapprovals` para esa combinación (cliente, comercio, clave, entidad, sucursal), pero sólo para dos cosas:

- **Continuar una sesión o reenviar contexto previo:** si hay una fila previa (sin filtrar por estado al leer), copia
  `RawResponse`, `RequestedAmount`, `CheckedAt`, `TransactionID` y `LenderSessionID` al `PreApprovalRequest`. Si la
  última fila estaba `pending` (hoy sólo la emite Credifamilia), conserva el id y la fecha de creación, reemplaza la
  fila y suma la latencia hasta que la sesión llega a aprobada o rechazada.
- **Las entidades manuales (BCP consumo y vehicular):** si el pedido no trae una decisión nueva (`lender_decision`) y hay
  una fila previa con `Status != StatusError`, devuelve esa fila sin llamar a nadie. Es el único caso en que reusa.

Una consulta que falla no escribe fila en `preapprovals`: devuelve el error y sólo deja su pata de auditoría
(`auditLeg`, en la tabla `preapproval_workflow_audit`), como también la deja cada veredicto antes de guardar su fila.
Una fila de error que exista nunca se toma como veredicto anterior de una entidad manual. Las filas de `preapprovals` traen `expires_at` (el adaptador de CreditopX la pone a 60 minutos), pero ese
vencimiento no decide si se vuelve a consultar.

La consecuencia para quien llama desde el backend: pedir la misma preaprobación dos veces es evaluar dos veces. El plan
del riel 4 que lee la preaprobación del motor (`creditop_x_pre_approval`) hace que el motor vuelva a evaluar al cliente;
si entre la tarjeta y el plan cambió el cupo, el plan puede salir con otro monto.

## El flujo de cada entidad: credenciales, autenticación, llamada y adaptación

Cada clave tiene su cliente, su estrategia de autenticación y su adaptador, armados en `factory.go`: Bancolombia (compra y
paga después, y consumo), Sistecrédito, Meddipay, CreditopX, Welli, Prami, Credifamilia, BCP consumo y vehicular,
Crédito365, Flamingo y Brilla (una única implementación que atiende `brilla` y cualquier clave con prefijo `brilla-`,
donde endpoint, token, CIIU y tipo de venta llegan en la credencial del comercio). `PreApprovalWorkflow` los corre en
cuatro etapas: pide las credenciales, se autentica (OAuth2, API key, token o nada), llama a la API y adapta la respuesta
al formato común (aprobada, rechazada o pendiente, con el monto aprobado y la respuesta cruda en `transaction_data`).

Reglas propias del servicio, antes o alrededor de esas etapas:

- **Alias de clave:** `Canonical()` traduce un alias a su clave base antes de validarla. En `main` existen
  `credifamilia-materiales` → `credifamilia` y `banco-finandina` → `creditop_x`. Una clave desconocida responde 400.
- **Welli:** las variantes 141 y 142 se consultan como la 23.
- **El perfil del cliente:** para toda clave salvo `creditop_x` lo pide a legacy-backend (`GET {user_service}/user/{id}`)
  y lo pasa a la entidad. El motor de CreditopX ya tiene al cliente y no lo necesita.
- **CreditopX:** llama a `POST /api/loans/lender/available-quota` de legacy-backend, sin autenticación. Es aprobada sólo
  si la respuesta trae `has_quota` y `status = approved` (el monto es `quota_details.max_requestable`); los rechazos
  preservan `rejection_reason` desde `data.reason` o el `reason` raíz.
- **Auditoría y errores:** ninguna clave guarda una fila de error en `preapprovals` cuando la entidad falla. Toda
  consulta, sea un veredicto o un fallo en cualquier etapa, graba una pata de auditoría (`auditLeg`, en el repositorio
  `workflowAudit`) con el tiempo y el estado de cada etapa y el último intercambio crudo que junta `StageRecorder`
  (lo registran los clientes de cada entidad, `runAPICall` y `CredentialsService`). La fila de un veredicto guarda la
  referencia a esa pata.
- **El aviso del resultado a legacy-backend** (`lender-result`, para el perfilamiento) está apagado
  (`legacyLenderResultEnabled = false`).

## Lo que guarda: historia en DynamoDB y credenciales en memoria

Guarda en DynamoDB, no en MySQL, en tres tablas:

| tabla | qué guarda |
|---|---|
| `preapprovals` | cada consulta o snapshot: cliente, comercio, sucursal, clave, entidad, estado, monto pedido y aprobado, `leg_ref`, `rejection_reason`, `lender_session_id`, latencia y vencimiento |
| `preapproval_attempts` | qué solicitud consultó a qué entidad (`LENDER#<entidad>` / `REQUEST#<solicitud>`) |
| `preapproval_workflow_audit` | la pata de auditoría de cada consulta (veredicto o fallo), referenciada por `leg_ref`, con `run_id`, estado/duración de etapas y cuerpos crudos |

Las filas nuevas de `preapprovals` ya no escriben `raw_request` ni `raw_response` (esas columnas quedan sólo de lectura
para filas históricas): los cuerpos crudos viven en `preapproval_workflow_audit` y se enlazan mediante `leg_ref`. La
clave de ordenación de `preapprovals` convive en dos formatos controlados en caliente por `features`:
`snapshot_keys_enabled: true` escribe un único ítem por combinación (`SNAP#<clave>#<id>#<comercio>#<sucursal>`)
sobrescribiendo en sitio sin transacción; `false` escribe una fila por consulta con estado y fecha en la clave, y
`legacy_key_fallback_enabled` mantiene legibles las filas históricas. Es historia y auditoría, no caché: ver la primera
sección.

Las credenciales de cada entidad las pide a legacy-backend (`POST /api/onboarding/credentials/get-by-lender`, que las
devuelve descifradas) y las guarda en un mapa en memoria por clave, entidad, comercio y sucursal, sin vencimiento: duran
hasta que se reinicia la instancia. `ClearCache` y `ClearCacheForLender` existen pero nadie las llama, y la segunda borra
por el id de la entidad, que no es la clave con la que se guarda. Una credencial rotada en el admin no se ve hasta un
reinicio.

## Lo que hace el asistente con cada respuesta: el estado de la tarjeta

El listado (`lenders-v2`) llega primero y cada tarjeta que no es tipo 0 arranca en `processing`. El asistente
(`available-lenders.tsx`) lanza la consulta de cada una sin esperarlas, y cada tarjeta cambia cuando llega su respuesta.
Pasan tres cosas, en este orden.

**Antes de preguntar, el backend puede vetar la consulta.** El listado marca cada entidad con `can_check_preapproval`
(`LenderListingService`). Sólo puede quedar en `false` una entidad con `requires_preapproval_gate` (hoy Prami): nace en
`false` y sólo `RiskCentralValidationService` la sube a `true`, si su regla de Datacrédito en la sucursal está apagada
(`status = 0`) o si está activa, las reglas duras no la dejaron en «Probabilidad muy baja» o «0% de probabilidad» y ve
pasadas sus tres validaciones con el Experian guardado: score, cuentas negativas y antigüedad en el sector. Una
validación sin dato cuenta como no pasada. Si falta la regla, o el servicio no corre (comercio sin fila activa en
`datacredito_frequencies`, cliente sin score), queda en `false`; `preapproval_gate_reason` vale `missing_configuration`
cuando falta la regla o la frecuencia activa del comercio. El asistente no consulta las vetadas: les pone
`policy_blocked` (`preapproval-gate.service.ts` compara `=== false`; un campo ausente se consulta).

**La respuesta decide el estado** (`statusToState`, en `fetch-lender-preapproval.ts`):

| respuesta del servicio | estado | la tarjeta |
|---|---|---|
| `approved` | `approved` | completa y elegible; toma el monto aprobado y, en `creditop_x`, la tasa y el FGA del perfil y el % de cuota inicial (`mergeLenderWithResolution`) |
| `rejected` | `rejected` | inerte, «Sin cupo disponible» |
| `not_eligible` | `not_eligible` | inerte, «No elegible por cupo desembolsado» |
| `frontend_response` | `frontend_response` | completa y elegible, «Probabilidad media» |
| `pending` | `processing` | sigue esperando; para Credifamilia vuelve a preguntar hasta 6 veces en 3 minutos |
| timeout, 4xx, 5xx o un cuerpo que no valida | `error` | inerte, y es el único estado con reintento: se ofrece si `isRetryableResolution` lo permite (bajo el monto mínimo, si el monto pedido lo alcanza) |
| (vetada antes) | `policy_blocked` | inerte, sin reintento |

Para el polling de respuestas transitorias (`isTransientError`), `isRetryableResolution` prioriza el campo `retryable`
del servicio y sólo cae a `http_5xx` o `timeout` cuando no viene. Un 401 de Meddipay no queda en error: la tarjeta pasa
a tipo 0 y el cliente sigue por el sitio de la entidad.

**Después, qué se ve y en qué orden** (`marketplace-view.service.ts`):

- Ninguna entidad se oculta por haber fallado (`visibles` no filtra por error): los errores, incluidos los 5xx, se
  muestran con su tarjeta inerte.
- Una entidad de respaldo (`is_fallback_lender`) se oculta apenas una entidad principal la cubre: si está aprobada
  alguna de `fallback_removal_specific_lender_ids`, o si una principal aprobó un monto mayor o igual al umbral
  (`fallback_removal_min_amount`, o el monto pedido si no hay umbral) (`fallback-lender.service.ts`).
- Una de las variantes de Welli se oculta según la comisión del aliado.
- El orden se recalcula a medida que llegan las respuestas (`computeLenderProbabilityBucket`): aprobadas arriba;
  rechazadas, no elegibles, con error o vetadas abajo; las que esperan se ordenan por la probabilidad del listado.

Cuando todas terminan, el asistente manda a legacy-backend las tarjetas que el cliente vio, sin las ocultas
(`lender-results`, ver [el listado](knowledge:lender-listing)). Como las tarjetas con error siguen visibles, también
viajan en ese snapshot con su razón, taxonomía (`error_code`, `failure_category`, `lender_http_status`, `retryable`) y
`leg_ref` (`buildLenderErrorFields`), salvo un 401 de Meddipay que se reporta como `not_registered` sin detalle.
