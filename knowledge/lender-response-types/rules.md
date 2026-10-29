# Rieles de una entidad: response_type

`lenders.response_type` dice **de quién es la política de crédito** y **por qué riel se origina**.
Antes de modelar una entidad nueva, la pregunta no es quién ejecuta la evaluación sino quién define
cómo se presta. Con los tipos 2 y 3, Creditop define las reglas. Con 0, 1 y 4, la entidad dice cómo
presta. La cobranza es otro eje: la marca `externally_serviced`.

| tipo | nombre en el código | política | preaprobación | origina y firma |
|---|---|---|---|---|
| 0 | `STANDARD` (referido, UTM) | de la entidad | no se consulta | la entidad, en su flujo |
| 1 | `PRE_APPROVED` / `INTEGRATED_API` | de la entidad | su API, por el `slug` | la entidad, en su flujo |
| 2 | `CREDITOP_X` (consumo) | de Creditop | motor de cupo (`creditop_x`) | rieles de Creditop |
| 3 | `CREDITOP_X_REVOLVING` (rotativo) | de Creditop | motor de cupo (`creditop_x`) | rieles de Creditop |
| 4 | `EXTERNALLY_MANAGED` (hoy Credifamilia) | de la entidad | por el `slug` | rieles de Creditop, y se radica ante la entidad |

## La política es lo que separa a los rieles

Es el criterio del equipo: si la entidad nos dice cómo presta, no es CreditopX,
aunque Creditop ejecute la evaluación. Por eso una entidad que entrega su política para que la
apliquemos, sin una API que decida, sigue siendo de tipo 4 y no de tipo 2.

El código lo refleja en tres lugares:

- El asistente pide la preaprobación con la clave `creditop_x` sólo para los tipos 2 y 3. Con
  cualquier otro tipo usa el `slug` de la entidad, y con el 0 no la pide.
- El motor de cupo (`POST /api/loans/lender/available-quota`, el que consulta el adaptador
  `creditop_x` de pre-approvals-service) rechaza los tipos 0 y 1 porque no tienen cupo financiado por
  Creditop, desvía el 3 al cupo rotativo y deja pasar el 2 y el 4.
- `originatesThroughFlow` del asistente considera originación externa sólo a los tipos 0 y 1: con 2,
  3 y 4 la solicitud se origina por nuestro flujo.

## Tipos 0 y 1: la entidad origina en su flujo

Con el tipo 0 el asistente no consulta preaprobación: el cliente sigue por la URL de la entidad
(`url_utm` de la sucursal o del comercio). Con el tipo 1, pre-approvals-service consulta la API de la
entidad por su `slug`, y sólo responde si conoce esa clave. Los tipos 1 y 4 exigen credencial propia
de la entidad en el punto de venta (`LenderIntegrationRules::REQUIRES_OWN_CREDENTIAL`). El 0 no la usa,
y CreditopX cobra con la credencial de Wompi del comercio.

## Tipos 2 y 3: Creditop define la política

El motor de cupo evalúa crédito activo, `lender_rules`, buró y categoría, con las reglas que configura
Creditop. Son los únicos tipos que el listado saca cuando fallan las reglas duras
(`dropsWhenRulesFail`: el 3 se queda si el cliente ya tiene cupo rotativo aprobado). Las demás
entidades quedan con «Probabilidad muy baja». Al autorizar un tipo 2 se cancelan las otras solicitudes
pendientes del cliente. El editor de reglas del backoffice y el admin viejo tratan como CreditopX sólo
a los tipos 2 y 3.

## Tipo 4: política de la entidad, rieles de Creditop

La solicitud recorre nuestro flujo: identidad, firma y pagaré. La decisión sale de la preaprobación por
el `slug`. Las reglas duras del listado no lo excluyen: la política de la entidad tiene que expresarse
en la preaprobación. En `legacy-backend`, el tipo 4 dispara tres ramas propias:

- **Fechas de pago:** `PaymentDateService` usa las fechas de la entidad externa.
- **Plan de cuotas:** `ExternallyManagedPaymentScheduleService` simula y confirma el plan.
- **Formalización al autorizar:** `LoanAuthorizationService` radica la operación ante la entidad.
  `CredifamiliaFormalizationService` reúne los documentos y pide a `LenderServiceFactory::make(lender_id)`
  un servicio que implemente `LenderFinalizationServiceInterface`. Ese servicio es el punto de extensión
  por entidad: se registra con el tag `lender.services` y declara qué ids atiende con `supports()`.

Hoy las tres ramas están implementadas sólo para Credifamilia. Las fechas de pago y el plan de cuotas
buscan la solicitud entre `CredifamiliaLenders::lenderIds()`, y las fechas usan los días fijos 2 y 16.
Los documentos de legalización son los de Credifamilia. Para una segunda entidad de tipo 4 hace falta
generalizar las tres, además de agregar su clave en pre-approvals-service. `legacy-application` no
tiene ramas del tipo 4; sólo lo agrupa con el 2 y el 3 al buscar la última solicitud de un usuario en
el admin.

## La cobranza es otro eje

`lenders.externally_serviced` dice si el ciclo de vida del crédito lo gestiona Creditop: pagos,
recordatorios y recaudo. Es independiente del tipo. Con `externally_serviced = 1` el chequeo de pagos
del backoffice no aplica y las campañas de recordatorio dejan afuera a la entidad. Un tipo 2 con
cobranza externa sigue siendo política de Creditop con cartera administrada por otro. No sirve para
modelar una entidad que dicta su propia política.
