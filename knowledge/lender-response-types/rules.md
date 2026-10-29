# Rieles de una entidad: response_type

`lenders.response_type` dice **de quién es la política de crédito** y **por qué riel se origina**.
Antes de modelar una entidad nueva, la pregunta no es quién ejecuta la evaluación sino quién define
cómo se presta. Con los tipos 2 y 3, Creditop define las reglas. Con 0, 1 y 4, la entidad dice cómo
presta. La cobranza es otro eje: la marca `externally_serviced`.

Cada tipo es un **riel** y se nombra por lo que hace, no por la entidad que lo usa hoy:

| riel | nombre | en el código | política | preaprobación | origina y firma |
|---|---|---|---|---|---|
| 0 | **Redirección** | `STANDARD` (referido, UTM) | de la entidad | no se consulta | la entidad, en su sitio |
| 1 | **Integrada** | `PRE_APPROVED` / `INTEGRATED_API` | de la entidad | su API, por el `slug` | la entidad, en su flujo |
| 2 | **CreditopX consumo** | `CREDITOP_X` | de Creditop | motor de cupo (`creditop_x`) | rieles de Creditop |
| 3 | **CreditopX rotativo** | `CREDITOP_X_REVOLVING` | de Creditop | motor de cupo (`creditop_x`) | rieles de Creditop |
| 4 | **Originación delegada** | `EXTERNALLY_MANAGED`, `RESPONSE_TYPE_CREDIFAMILIA` | de la entidad | por el `slug` | rieles de Creditop, y se radica ante la entidad |

En originación delegada, la entidad le delega a Creditop originar con su política: Creditop pone
identidad, firma, pagaré y radicación, y la entidad desembolsa y cobra. No se le dice «gestión externa»
ni «riel de Credifamilia»: lo primero se confunde con `externally_serviced`, que es la cobranza, y lo
segundo confunde el riel con su primera entidad.

## La política es lo que separa a los rieles

Es el criterio del equipo: si la entidad nos dice cómo presta, no es CreditopX,
aunque Creditop ejecute la evaluación. Por eso una entidad que entrega su política para que la
apliquemos, sin una API que decida, sigue siendo de originación delegada (riel 4) y no CreditopX (riel 2).

El código lo refleja en tres lugares:

- El asistente pide la preaprobación con la clave `creditop_x` sólo para los tipos 2 y 3. Con
  cualquier otro tipo usa el `slug` de la entidad, y con el 0 no la pide.
- El motor de cupo (`POST /api/loans/lender/available-quota`, el que consulta el adaptador
  `creditop_x` de pre-approvals-service) rechaza los tipos 0 y 1 porque no tienen cupo financiado por
  Creditop, desvía el 3 al cupo rotativo y deja pasar el 2 y el 4.
- `originatesThroughFlow` del asistente considera originación externa sólo a los tipos 0 y 1: con 2,
  3 y 4 la solicitud se origina por nuestro flujo.

## Tipos 0 y 1: la entidad origina en su flujo

Con la redirección (tipo 0) el asistente no consulta preaprobación: el cliente sigue por la URL de la entidad
(`url_utm` de la sucursal o del comercio). Con la integrada (tipo 1), pre-approvals-service consulta la API de la
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

Es la originación delegada. La solicitud recorre nuestro flujo: identidad, firma y pagaré. La decisión sale de la preaprobación por
el `slug`. Las reglas duras del listado no lo excluyen: la política de la entidad tiene que expresarse
en la preaprobación. En `legacy-backend`, el tipo 4 dispara tres ramas propias:

- **Fechas de pago:** `PaymentDateService` usa las fechas de la entidad externa.
- **Plan de cuotas:** `ExternallyManagedPaymentScheduleService` simula y confirma el plan.
- **Formalización al autorizar:** `LoanAuthorizationService` radica la operación ante la entidad.
  `CredifamiliaFormalizationService` reúne los documentos y pide a `LenderServiceFactory::make(lender_id)`
  un servicio que implemente `LenderFinalizationServiceInterface`. Ese servicio es el punto de extensión
  por entidad: se registra con el tag `lender.services` y declara qué ids atiende con `supports()`.

La puerta es por tipo, pero lo que corre adentro está atado a Credifamilia:

- **Opciones de crédito y amortización:** `CredifamiliaLoanOptionsService` y su motor usan
  `CredifamiliaLenderProfile`, que tira error con cualquier id que no sea de Credifamilia. Las rutas son
  `payment-plan/credifamilia/*`.
- **Fechas, cuotas, continuar solicitud, resumen y comprobante:** cada servicio busca la solicitud sólo
  entre `CredifamiliaLenders::lenderIds()`. Las fechas además fijan los días 2 y 16.
- **Firma:** `PromissoryNoteController` usa el proveedor de firma y `CredifamiliaDocumentsBuilder` sólo
  cuando `lender_id` es 24, y el builder genera los documentos con el id 24 fijo.
- **Formalización:** los documentos de legalización son los de Credifamilia. El cierre ante la entidad sí
  se resuelve por entidad.
- **Asistente:** `DYNAMIC_PAYMENT_PLAN_LENDER_IDS` (24, 214 y 216) decide qué entidades calculan la cuota
  en el backend.

Son de Credifamilia, y está bien que lo sean, su radicación SOAP, CrossCore, Evidente y Jumio, y el
adaptador `credifamilia` de pre-approvals-service. Para una segunda entidad de tipo 4 hay que generalizar
las piezas de la lista y agregar su clave en pre-approvals-service. `legacy-application` no tiene ramas del
tipo 4; sólo lo agrupa con el 2 y el 3 al buscar la última solicitud de un usuario en el admin.

## La cobranza es otro eje

`lenders.externally_serviced` dice si el ciclo de vida del crédito lo gestiona Creditop: pagos,
recordatorios y recaudo. Es independiente del tipo. Con `externally_serviced = 1` el chequeo de pagos
del backoffice no aplica y las campañas de recordatorio dejan afuera a la entidad. Un tipo 2 con
cobranza externa sigue siendo política de Creditop con cartera administrada por otro. No sirve para
modelar una entidad que dicta su propia política.
