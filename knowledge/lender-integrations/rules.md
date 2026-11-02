# Entidades integradas: reglas propias de cada una

Además de las reglas comunes del listado (`lender-listing`) y de su riel (`lender-response-types`),
varias entidades externas tienen comportamiento propio en el código, casi siempre por un pedido de la
entidad o un incidente con un comercio. Este tema junta esas reglas por entidad, con el monolito donde
viven. El porqué viene de Jira (se cita la clave) y el mecanismo, del código de `main`.

## Prami: sólo se consulta si pasa sus reglas de buró

Prami (consulta Experian por medio de Quanto) cobra la consulta y rechazaba a casi todos los que no
pasaban su corte de score (CORE-300, CORE-459). Por eso las entidades marcadas con
`lenders.requires_preapproval_gate` —hoy Prami— sólo habilitan la consulta de preaprobación si el
cliente pasa **las tres** partes de su regla de datacrédito: score, cuentas negativas y antigüedad en
el sector. Si no, el listado de legacy-backend envía `can_check_preapproval = false` y la tarjeta
queda «No disponible para tu perfil», sin selección ni reintento. Las entidades sin la marca no pueden
salir en false por ese camino.

Un webhook tardío de Prami no saca a una solicitud de Autorizada (ver `user-request-lifecycle`), y
cada nueva consulta genera un `order_id` nuevo en Prami (CORE-738).

## Welli: cuatro variantes, Sonría aparte y dos mapas de estado

Welli (crédito odontológico) existe como **cuatro entidades** —23 tasa full, 141 tasa 0, 142 tasa
subsidiada y 166— porque cada tasa es una «clínica» distinta del lado de Welli: cambiar de tasa obliga
a cambiar de clínica (`change-clinic`), y el asistente nuevo lo hace cuando el cliente vio más de una
variante (LEN-36, LEN-98).

- **Sonría (aliado 26)**: el webhook de Welli en legacy-application registra el evento, responde OK y
  **no toca la solicitud**; en Sonría la autorización es manual y no hay voucher. CORE-375 propuso
  cambiarlo y quedó invalidado: es decisión vigente.
- **Mapa de estados**: los dos monolitos traducen igual casi todos los estados de Welli, salvo
  `pendiente_desembolso`. legacy-application lo lleva a 28 (Pendiente desembolso); legacy-backend, a
  **11** (Autorizada), con un TODO de paridad que advierte que marca como desembolsado un crédito que
  no lo está y llena `final_amount`. El de legacy-backend se aplica cuando el asistente nuevo vuelve
  a seleccionar Welli y consulta su estado; el webhook sigue en legacy-application.
- legacy-backend además trata `risk_in_process` y `fraud` como Negada (6); legacy-application no los
  mapea.

## Meddipay: reintentos sólo ante caídas

Meddipay (crédito de salud) reintenta 3 veces con 1 segundo de espera, **sólo** ante errores de
conexión o respuestas 5xx; un 4xx o un rechazo no se reintenta (LEN-282). Exige el género en
mayúscula y la fecha de nacimiento en formato `Y-m-d` (LEN-269). Es igual en los dos monolitos.

## Sistecrédito: se oculta al moroso

Al consultar la preaprobación de Sistecrédito, si la respuesta es aprobada pero marca al cliente como
**moroso** (`defaulter`), la entidad se quita del listado. Aprobada con cupo disponible 0 también se
quita; con cupo, pasa a «Pre aprobado» arriba del listado. Si no es aprobada, se mantiene como opción
normal, **salvo en Energiteca (aliado 153)**, donde se quita: ese comercio sólo quiere mostrarla a
clientes de Sistecrédito (CACM-380). La regla de Energiteca existe en los dos monolitos.

## Bancolombia BNPL: el canal va en el NIT de Corbeta

Para los comercios de Corbeta, Bancolombia distingue la venta física de la ecommerce por el NIT del
`subThirdParty`: sin dígito de verificación en tienda y **con** dígito (`8909009431`) en ecommerce.
Lo pidió Riesgos de Bancolombia para poder bloquear en tienda los cupos que vencen el mismo día sin
afectar la tienda online (LEN-272, CORE-386). Está sólo en legacy-backend y sólo en producción; el
`thirdParty` no cambia y los demás comercios no entran.

## Crédito 365: el estado va en el cuerpo, no en el HTTP

El adaptador de pre-approvals-service para Crédito 365 decide por el campo `status` del cuerpo,
porque Crédito 365 responde HTTP 200 tanto para `NOT_ELIGIBLE` como para `ALREADY_REGISTERED`, que
significan lo contrario. También distingue `PREAPPROVED`, `AMOUNT_OUT_OF_RANGE`, `VALIDATION_ERROR` y
el conflicto de id externo. Una preaprobación vale 30 días. CORE-666 pide explicar al cliente el rango
de monto en vez de que la tarjeta desaparezca.

## UMA: el aliado que gestiona por su propio endpoint

UMA (aliado 225, motos Triumph) gestiona la solicitud ante los bancos. En legacy-backend, la gestión
manual del comercio rechaza ese aliado y lo manda a su endpoint propio; en legacy-application, la
actualización del comercio sólo se acepta para ese aliado, y al pasar a Autorizada exige número y valor
de cuota (LO-54).

## Probabilidad oculta por convenio o por comercio

La etiqueta de probabilidad de una tarjeta se puede ocultar de dos formas, y la del comercio manda:

- **por comercio** (`allieds.hide_non_integrated_probability`): prendida, oculta la probabilidad de
  todas las entidades **no integradas** (riel 0) y deja ver la de las integradas, sin mirar el
  convenio;
- **por convenio** (`lenders_by_allieds.hide_probability`): con la del comercio apagada, oculta la
  probabilidad de esa entidad en ese comercio, integrada o no.

Se pidió para que Sonría no mostrara probabilidad de entidades sin integración, sin quemar el comercio
en el código (QC-17). El convenio se configura en los dos admins, pero sólo el listado de
legacy-backend entrega la marca al asistente, que es quien la aplica.
