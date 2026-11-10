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
  cualquier otro tipo usa el `slug` de la entidad (salvo las variantes de Welli, que comparten la clave
  `welli`), y con el 0 no la pide.
- El motor de cupo (`POST /api/loans/lender/available-quota`, el que consulta el adaptador
  `creditop_x` de pre-approvals-service) rechaza los tipos 0 y 1 porque no tienen cupo financiado por
  Creditop, desvía el 3 al cupo rotativo y deja pasar el 2 y el 4.
- `originatesThroughFlow` del asistente considera originación externa sólo a los tipos 0 y 1: con 2,
  3 y 4 la solicitud se origina por nuestro flujo.

## Tipos 0 y 1: la entidad origina en su flujo

Con la redirección (tipo 0) el asistente no consulta preaprobación: el cliente sigue por la URL de la entidad
(`url_utm` de la sucursal o del comercio). Con la integrada (tipo 1), pre-approvals-service consulta la API de la
entidad por su `slug` (las variantes de Welli comparten la clave `welli` y las distingue el id), y sólo
responde si conoce esa clave; antes de validarla normaliza los alias conocidos
(`LendingProductKey::Canonical`). Los tipos 1 y 4 exigen credencial propia de la entidad en el punto de
venta (`LenderIntegrationRules::REQUIRES_OWN_CREDENTIAL`, con `RESPONSE_TYPE_INTEGRATED_API` y
`RESPONSE_TYPE_DELEGATED_ORIGINATION`). El 0 no la usa, y CreditopX cobra con la credencial de Wompi del comercio.

## Tipos 2 y 3: Creditop define la política

El motor de cupo evalúa crédito activo, el tope de créditos del cliente con la entidad en el mes
(`max_credits_per_client_month`, `ClientMonthlyCreditRuleEvaluator`), `lender_rules`, buró y categoría,
con las reglas que configura Creditop. Si la entidad tiene tope de desembolsos del mes
(`monthly_disbursement_limit`) y lo que le queda no alcanza, el rechazo sale como
`lender_quota_exhausted` en vez de `below_min_amount` o `zero_quota_calculated`. Son los únicos tipos
que el listado saca cuando fallan las reglas duras (`dropsWhenRulesFail`: el 3 se queda si el cliente ya
tiene cupo rotativo aprobado); el listado saca además a un tipo 2 que pasó las reglas duras si el cliente
ya llegó a su tope de créditos del mes. Las reglas duras del listado comparan campos de formulario
(`field_id`) y, por tabla, sólo `age`, `gender` y `document_type`. Las demás entidades quedan con «Probabilidad muy baja», salvo cuatro ids fijos en el
código (5, 135, 136 y 137) que quedan con «0% de probabilidad». Al autorizar un tipo 2 se cancelan las
otras solicitudes del mismo cliente en el mismo comercio cuya entidad también es tipo 2 y que no están
en el estado 11 ni tienen fila `CREACIÓN`; las de otros tipos no se tocan. El desembolso IMEI de
SmartPay la corre sin mirar el tipo de la entidad. El selector del editor de reglas del backoffice lista como
CreditopX sólo el tipo 2 (`LenderRulesMap::CREDITOPX_RESPONSE_TYPES`); la política dura del 3 se
edita aparte, en la pantalla del rotativo. El admin viejo (`legacy-application`) crea la configuración CreditopX de la
entidad con 2 y 3 al editarla, pero sólo con 2 al darla de alta.

## Tipo 4: política de la entidad, rieles de Creditop

Es la originación delegada. La solicitud recorre nuestro flujo: identidad, firma y pagaré. La decisión sale de la preaprobación de la
entidad. Las reglas duras del listado no lo excluyen: la política de la entidad tiene que expresarse
en la preaprobación. En `legacy-backend` la pertenencia al riel se decide por el tipo
(`DelegatedOriginationLenders::RESPONSE_TYPE`, 4), no por una lista de ids, y el tipo 4 dispara tres ramas propias:

- **Fechas de pago:** `PaymentDateService` le pide las fechas a `PaymentPlanDatesService`.
- **Plan de cuotas:** `ExternallyManagedPaymentScheduleService` (su `supports()` pregunta por el tipo 4)
  simula y confirma el plan con `InstallmentPlanService`.
- **Formalización al autorizar:** después del commit de la autorización y en su propia transacción,
  `LoanAuthorizationService::formalizeExternalManagedIfApplicable` lee la clave `formalization` del
  perfil de la entidad. Con null no radica y lo deja en el log; con una clave,
  `DelegatedOriginationFormalizations::for` devuelve la clase que implementa
  `DelegatedOriginationFormalization` (hoy sólo `credifamilia_radication` →
  `CredifamiliaFormalizationService`). Un `FormalizationException` sale como 422 con la autorización ya
  persistida. `CredifamiliaFormalizationService` reúne los documentos y pide a
  `LenderServiceFactory::make(lender_id)` un servicio que implemente `LenderFinalizationServiceInterface`.
  Ese servicio es el punto de extensión por entidad: se registra con el tag `lender.services` y declara
  qué ids atiende con `supports()`.

Lo que cambia entre las entidades del riel vive en `delegated_origination_profiles`, una fila por entidad
leída por `DelegatedOriginationLenderProfile::forLender`, que tira si la entidad no tiene fila o si la
fila no trae días de pago (nunca toma el perfil de otra): `bond_percentage_source` (`pre_approval`, el %
de la preaprobación, o `fng_table`, el % por plazo de `lender_term_fng_percentages`), `forced_bond_type`
(pisa el tipo de fianza de la preaprobación), `applies_four_per_thousand`, `payment_days` (JSON; el
primero es el que se usa cuando el cliente todavía no eligió), `inputs_source` (clave de
`DelegatedOriginationInputsSources`, hoy sólo `credifamilia_pre_approval` →
`CredifamiliaPreApprovalInputs`) y `formalization`. La migración que siembra los perfiles deja a Salud
con fianza de la preaprobación y 4x1000, y a Materiales con fianza de la tabla FNG, anticipada y con
4x1000; los dos pagan el 2 o el 16, toman los insumos de la preaprobación de Credifamilia y radican por
su SOAP. Sólo siembra las entidades que existen en esa base.

El plan de pago corre en `App\Services\PaymentPlan\DelegatedOrigination` (`PaymentPlanLoanOptionsService`,
`PaymentPlanDatesService`, `InstallmentPlanService`, `PaymentPlanContinueRequestService`,
`PaymentPlanSummaryService`, `PaymentPlanVoucherService`, `PaymentPlanPayloadBuilder`). Las rutas son
`payment-plan/{lender_slug}/…` (`continue-request`, `payment-dates`, `installment-plan`, `loan-options`,
`payment-plan-summary`, `voucher`): el controlador resuelve el slug con
`DelegatedOriginationLenders::findBySlug` (slug y tipo 4) y responde 404 `CP011` si la entidad no es del
riel; `credifamilia` sigue siendo la URL de Salud y `payment-plan/credifamilia/calculate` quedó fija. Cada
servicio acota la solicitud con `DelegatedOriginationLenders::constrainRequests`: a la entidad de la ruta,
o a cualquier entidad de tipo 4 cuando lo llama un servicio interno sin entidad.

Lo que sigue atado a Credifamilia:

- **Entidad de cálculo por defecto:** sin entidad de la ruta, `PaymentPlanLoanOptionsService` y
  `PaymentPlanPayloadBuilder` calculan con `CredifamiliaLenders::engineLenderIdFor`: el id de la
  solicitud si es de Credifamilia, y si no el 24. `PaymentPlanLoanOptionsService` acepta solicitudes sin
  entidad (null o 0) o del riel, y cualquiera con `skip_lender_validation`.
- **Preaprobación desde el backend:** `CredifamiliaPreApprovalInputs` consulta pre-approvals-service con
  la clave fija `credifamilia` (`CredifamiliaLenders::LENDING_PRODUCT_KEY`, no el `slug` de la entidad) y
  el id de la entidad como `lending_product_id`. El asistente manda el `slug`; pre-approvals-service
  normaliza el alias `credifamilia-materiales` a `credifamilia` (`LendingProductKey::Canonical`) antes de
  validar, así front y backend comparten la misma fila, y Salud y Materiales se separan por
  `lending_product_id`.
- **Firma:** `PromissoryNoteController` usa el proveedor de firma y `CredifamiliaDocumentsBuilder` sólo
  para las entidades de `CredifamiliaLenders` (Salud, 24, y Materiales, 214 en producción y 216 en los
  demás ambientes según `app()->isProduction()`, nunca los dos), y genera los documentos con la
  configuración de pdf-mapper de la entidad de la solicitud; cualquier otra cae a la del 24.
- **Formalización:** el único paquete registrado es el de legalización de Credifamilia; el cierre ante la
  entidad sí se resuelve por entidad.
- **SOAP:** `CredifamiliaLenders::soapVerticalFor` manda `Salud` o `Materiales` y tira con cualquier
  otro id.

En el asistente, `supportsDynamicPaymentPlan` decide por tipo: toda entidad de tipo 4 calcula la cuota
en el backend (`payment-plan/{slug}/loan-options`). Son de Credifamilia, y está bien que lo sean, su
radicación SOAP, CrossCore, Evidente y Jumio, y el adaptador `credifamilia` de pre-approvals-service.
Para una segunda entidad de tipo 4 hace falta su fila de perfil, una fuente de insumos y una
formalización registradas si no usa las de Credifamilia, y su clave en pre-approvals-service.
`LenderIntegrationRules::REQUIRES_OWN_CREDENTIAL` le exige credencial propia por tipo
(`RESPONSE_TYPE_DELEGATED_ORIGINATION`). `legacy-application` no tiene ramas del tipo 4: lo agrupa con
el 2 y el 3 al buscar la última solicitud de un usuario en la validación manual del admin, y su listado
de entidades (`LenderRetrievalService`) trata al 24 por id, no por tipo: le reescribe `response_type` a 1
y, con link de pago, lo incluye junto a las de tipo 1.

## La cobranza es otro eje

`lenders.externally_serviced` dice si el ciclo de vida del crédito lo gestiona Creditop: pagos,
recordatorios y recaudo. Es independiente del tipo. Con `externally_serviced = 1` el chequeo de pagos
del backoffice no aplica y las campañas de recordatorio dejan afuera a la entidad. Con cobranza de
Creditop, el chequeo de pagos del readiness depende del método de pago de la entidad
(`payment_methods_by_lender`, el que mandan los recordatorios y que también se guarda desde la
configuración del backoffice): sin fila bloquea; si es externo (el portal de la entidad, o `N/A` con
instrucciones) pasa sin pedir cuentas de Wompi; si es el checkout de Creditop exige al menos un
comercio que pueda cobrar. Un tipo 2 con
cobranza externa sigue siendo política de Creditop con cartera administrada por otro. No sirve para
modelar una entidad que dicta su propia política.
