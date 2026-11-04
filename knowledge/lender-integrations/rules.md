# Entidades integradas: reglas propias de cada una

Además de las reglas comunes del listado (`lender-listing`) y de su riel (`lender-response-types`),
varias entidades externas tienen comportamiento propio en el código, casi siempre por un pedido de la
entidad o un incidente con un comercio. Este tema junta esas reglas por entidad, con el monolito donde
viven. El porqué viene de Jira (se cita la clave) y el mecanismo, del código de `main`.

## Prami: sólo se consulta si pasa sus reglas de buró

Prami (consulta Experian por medio de Quanto) cobra la consulta y rechaza a quien no pasa su corte de
score (CORE-300, CORE-459). Por eso las entidades marcadas con `lenders.requires_preapproval_gate`
—hoy Prami— nacen en el listado v2 de legacy-backend con `can_check_preapproval = false`, y sólo
`RiskCentralValidationService` lo sube a true, si el cliente pasa **las tres** partes de la regla de
datacrédito de la sucursal: score, cuentas negativas y antigüedad en el sector. Una parte que no se
pudo evaluar por falta del dato no cuenta como pasada. Si ese servicio no corre (comercio sin fila en
`datacredito_frequencies`, cliente sin score), si la sucursal no tiene regla de datacrédito para la
entidad o si las reglas duras ya la dejaron en «Probabilidad muy baja» o «0% de probabilidad», el flag
queda en false. Las entidades sin la marca nacen en true y ningún camino las baja.

En el asistente nuevo, una entidad con `can_check_preapproval === false` no se consulta a
pre-approvals-service: queda en el estado terminal `policy_blocked`, con la tarjeta «No disponible
para tu perfil», sin selección ni reintento. Un campo ausente se consulta como antes, y las variantes
de Welli están exentas de esta compuerta en el front.

No pasar la regla **no saca a Prami del listado**: como cualquier regla de datacrédito en ese
servicio, la entidad vuelve a la lista con la probabilidad de su nivel (ver `lender-listing`), y lo
que cambia es que la consulta queda cerrada.

El webhook de Prami vive en legacy-application: si la solicitud ya está en 11 (Autorizada), registra
el evento, responde 200 con `IGNORED` y no la toca (ver `user-request-lifecycle`). Prami emite un
`order_id` nuevo en cada cotización; al registrar, los dos monolitos lo copian a la transacción
existente si ningún otro registro de la entidad lo tiene, para que el webhook la encuentre (CORE-738).
Meddipay usa el mismo mecanismo.

Se comprueba corriendo con `make harness-suite TARGET=local SUITE=harness/suites/compuerta-prami.json`:
un cliente que pasa, y uno por cada parte de la regla que falla.

## Welli: cuatro variantes, Sonría aparte y dos mapas de estado

Welli (crédito odontológico) existe como **cuatro entidades** —23 tasa full, 141 tasa 0, 142 tasa
subsidiada y 166 riesgo compartido— porque cada tasa es una «clínica» distinta del lado de Welli:
cambiar de tasa obliga a cambiar de clínica (`change-clinic`). En legacy-backend, al registrar una
variante Welli, el asistente nuevo llama a `changeClinic` sólo si al cliente se le mostró más de una
variante (`profiling_reviews.displayed_lenders`) (LEN-36, LEN-98).

- **Sonría (aliado 26)**: el webhook de Welli en legacy-application registra el evento, responde OK y
  **no toca la transacción ni la solicitud**, así que tampoco emite voucher; en Sonría la autorización
  es manual. CORE-375 propuso cambiarlo y quedó invalidado: es decisión vigente. La excepción está
  sólo en ese webhook: la consulta de estado de legacy-backend no mira el aliado.
- **Mapa de estados**: los dos monolitos traducen igual casi todos los estados de Welli, salvo
  `pendiente_desembolso`. legacy-application lo lleva al id 28, un estado propio cuyo nombre depende
  del catálogo del ambiente (ver `user-request-lifecycle`); legacy-backend, a **11** (Autorizada), con
  un TODO de paridad que advierte que marca como desembolsado un crédito que no lo está y llena
  `final_amount` y `request_number`. El mapa de legacy-backend se aplica cuando el asistente nuevo
  registra una variante Welli: consulta el estado enseguida (`updateStatus`) y encola un sondeo
  (`StatusCheck`, cada 2 s hasta 30 minutos, que se detiene en un estado conocido, también
  `pendiente_desembolso`). El webhook sigue en legacy-application.
- legacy-backend además trata `risk_in_process` y `fraud` como Negada (6); legacy-application no los
  mapea, y su webhook rechaza en la validación cualquier estado fuera de su mapa.

## Meddipay: reintentos sólo ante caídas

Meddipay (crédito de salud) hace hasta 3 intentos con 1 segundo de espera (`retry(3, 1000)`), **sólo**
ante errores de conexión o respuestas 5xx; un 4xx o un rechazo no se reintenta (LEN-282). Exige el
género en mayúscula y la fecha de nacimiento en formato `Y-m-d` (LEN-269). Es igual en los dos
monolitos. En el asistente nuevo, un 401 de pre-approvals-service para Meddipay (lender 39) significa
que el cliente no está registrado: el front la baja a riel 0 y la muestra como entidad tradicional,
en vez de una tarjeta de error.

## Sistecrédito: al moroso lo oculta sólo el camino viejo

Hay dos caminos que deciden la tarjeta de Sistecrédito, y no aplican la misma regla:

- **El camino viejo** (`PreApprovedLenderService`, que usa el listado v1 de legacy-backend, y su par
  en legacy-application): si la respuesta es aprobada pero marca al cliente como **moroso**
  (`defaulter`), la entidad se quita del listado; aprobada con cupo disponible 0 también se quita;
  con cupo, pasa a «Pre aprobado» arriba. Si no es aprobada se mantiene como opción normal, **salvo
  en Energiteca (aliado 153)**, donde se quita: ese comercio sólo quiere mostrarla a clientes de
  Sistecrédito (CACM-380).
- **El asistente nuevo** pide el listado v2, que no pasa por `PreApprovedLenderService`, y la
  preaprobación a pre-approvals-service. Su adaptador de Sistecrédito lee `defaulter` pero no lo usa:
  aprueba si el estado es 1 y la cuenta está activa, y el monto es el cupo disponible si es mayor que
  0. Ni el listado v2 ni el front miran `defaulter`, así que el asistente nuevo **no oculta** a un
  cliente moroso con cuenta activa: sale aprobado. La regla de Energiteca tampoco existe ahí.

Aparte, al guardar los datos laborales legacy-backend consulta a las entidades
(`OnboardingService::validatePreApproveLender`) para decidir si salta Experian; en local y
development no la llama y usa un booleano al azar (F-246). Ninguno de esos caminos es el listado del
asistente nuevo, así que no hay suite local de la regla del moroso: en el camino que usa el cliente
no existe.

## Bancolombia BNPL: el canal va en el NIT de Corbeta

Para los comercios de Corbeta, Bancolombia distingue la venta física de la ecommerce por el NIT del
`subThirdParty`: sin dígito de verificación en tienda y **con** dígito (`8909009431`) en ecommerce.
Lo pidió Riesgos de Bancolombia para poder bloquear en tienda los cupos que vencen el mismo día sin
afectar la tienda online (LEN-272, CORE-386). Está sólo en legacy-backend y sólo en producción: se
activa cuando la credencial de la sucursal tiene el NIT `890900943` y la solicitud viene de una
tienda. El `thirdParty` no cambia y los demás comercios no entran.

## Crédito 365: el estado va en el cuerpo, no en el HTTP

El adaptador de pre-approvals-service para Crédito 365 decide por el campo `status` del cuerpo,
porque Crédito 365 responde HTTP 200 tanto para `NOT_ELIGIBLE` como para `ALREADY_REGISTERED`, que
significan lo contrario. `PREAPPROVED` y `ALREADY_REGISTERED` dan aprobado con monto; `NOT_ELIGIBLE`
(cliente recurrente) da rechazo; `AMOUNT_OUT_OF_RANGE`, `VALIDATION_ERROR` y el conflicto de id
externo son errores que no se guardan como preaprobación; un estado desconocido también es error.
Una preaprobación vale 30 días. CORE-666 pide explicar al cliente el rango de monto en vez de que la
tarjeta desaparezca.

## UMA: el aliado que gestiona por su propio endpoint

UMA (aliado 225, motos Triumph) gestiona la solicitud ante los bancos. En legacy-backend, la gestión
manual del comercio rechaza ese aliado (422) y lo manda a su endpoint propio; en legacy-application,
ese endpoint (`uma-actualizar-solicitud`) sólo acepta solicitudes de ese aliado y los estados 6, 9, 11
y 20. Al pasar a 11 (Autorizada) exige monto final y número de solicitud; número y valor de cuota se
guardan si llegan, sin ser obligatorios. En cualquier otro estado limpia esos campos (LO-54).

## Probabilidad oculta por convenio o por comercio

La etiqueta de probabilidad de una tarjeta se puede ocultar de dos formas, y la del comercio manda:

- **por comercio** (`allieds.hide_non_integrated_probability`): prendida, oculta la probabilidad de
  todas las entidades **no integradas** (riel 0) y deja ver la de las integradas, sin mirar el
  convenio;
- **por convenio** (`lenders_by_allieds.hide_probability`): con la del comercio apagada, oculta la
  probabilidad de esa entidad en ese comercio, integrada o no.

Se pidió para que Sonría no mostrara probabilidad de entidades sin integración, sin quemar el comercio
en el código (QC-17). El convenio se configura en los dos admins; la marca del comercio sólo la
escribe legacy-backend. Sólo el listado v2 de legacy-backend entrega las dos al asistente nuevo, que
es quien las aplica.
