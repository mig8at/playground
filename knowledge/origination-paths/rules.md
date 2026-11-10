# Recorrido de una solicitud: canal, riel y variaciones

Un **recorrido** es el camino que sigue una solicitud desde que entra hasta que termina. Se describe con
ocho piezas que no se mezclan: **canal**, **tramo común**, **riel**, **producto**, **variaciones**,
**campos**, **ajustes** y **desenlace**. Con ellas se puede decir de un cambio si cae en un recorrido que ya existe,
si le agrega una variación o si hace falta uno nuevo.

Se escribe en una línea: `canal · riel · producto · +variación · desenlace`. Por ejemplo,
`asesor · riel 2 · renting operativo · +ábaco · autorización`.

## Canal: por dónde entra la solicitud

El canal dice quién arranca la solicitud y por qué rutas del asistente pasa. El asistente
(`loan-request-wizard`) lo lleva en la URL:

- **Asesor**: el vendedor del comercio la arranca en `/merchant/{hash}/…`. Es el único árbol con las
  pantallas del comercio (solicitudes, perfilamiento, código de cliente) y con el registro de IMEI.
- **Autogestión**: el cliente desde su celular, en `/self-service/{hash}/…`.
- **Tienda**: el ecommerce, en `/ecommerce/{hash}/…`, que entra por `checkout` con el pedido. Si la
  tienda manda el pedido **firmado** (`MerchantOrderSignatureService`), la sesión entra por el árbol
  `/auto/{hash}/…` (auto-onboarding) con el token del pedido y se salta el código del celular; si el
  backend rechaza el token, sigue por el código como cualquier otra.
- **Bancolombia**: un árbol propio, `/bancolombia/…`, para sus dos entidades (compra y paga después, y
  crédito de consumo). Arranca en `bancolombia/self-service/{hash}` y se bifurca por `bnpl` o
  `consumo`; termina con el código de compra para pagar en caja
  ([código de compra](knowledge:purchase-code-lifecycle)).

Autogestión y tienda comparten el árbol `/:flow/{hash}/…`: el layout público sólo acepta `ecommerce` y
`self-service` como valor de `:flow`. Asesor tiene su propio árbol con las mismas pantallas del tramo
común, más las del comercio.

## Tramo común: hasta el listado

Los canales del asistente (asesor, autogestión y tienda) recorren lo mismo hasta el listado de
entidades: monto, celular, código, datos personales, empleo y listado. La entrada firmada de la tienda
se salta el código. Bancolombia no pasa por este tramo.

## Riel: qué hace la solicitud después del listado

El riel es `lenders.response_type` de la entidad elegida
([rieles de una entidad](knowledge:lender-response-types)). Se agrupa por dos ejes, que conviene
nombrar por separado:

| riel | nombre | dueño de la política | dónde se origina |
|---|---|---|---|
| 0 | Redirección | la entidad | afuera |
| 1 | Integrada | la entidad | afuera |
| 2 | CreditopX consumo | Creditop | en casa |
| 3 | CreditopX rotativo | Creditop | en casa |
| 4 | Originación delegada | la entidad | en casa |

- **Dueño de la política**: quién define cómo se presta. Separa a CreditopX (2 y 3) del resto.
- **Dónde se origina**: **afuera** quiere decir que la entidad sigue en su sitio o su flujo; **en casa**,
  que la solicitud recorre las pantallas de Creditop (confirmación, identidad, plan de pagos, firma).
  En el asistente, `originatesThroughFlow` devuelve falso sólo para los tipos 0 y 1.

El riel 4 está **en casa** pero **no es CreditopX**: no se le dice «CreditopX in-platform».

## Producto: qué se financia

`lenders.product` dice qué se ofrece: **compra financiada** (`credit`), **renting operativo**
(`renting`) o **Rent-to-Own** (`rto`). El producto cambia la tarjeta del listado (renting y Rent-to-Own
muestran calculadora; renting no muestra total) y el juego de documentos que se firma, que se elige
por producto. No cambia el riel.

## Variaciones y ajustes

Una **variación** cambia el camino: agrega o quita pantallas o pasos. Un **ajuste** cambia valores sin
cambiar el camino: días de pago, plazos, tasa, reglas, categorías. La diferencia importa porque un
ajuste se resuelve configurando y una variación nueva pide código y pruebas propias.

Las variaciones vigentes, con lo que las activa:

| variación | se activa cuando | se decide |
|---|---|---|
| **Ábaco** | la entidad tiene `lender_requirements.abaco_is_enabled` y el cliente no tiene una consulta vigente | por entidad (`AbacoRequirementService`) |
| **Formulario adicional** | la entidad tiene un formulario dinámico después de elegirla o antes de firmar; la tabla central de ubicaciones manda y, sin filas para ese punto, se hereda de la configuración anterior | por entidad (`LenderFormPlacementResolver`) |
| **Aprobación manual** | la entidad tiene `lender_requirements.manual_approval`: un asesor aprueba antes de seguir | por entidad |
| **IMEI** | la entidad tiene la ruta `IMEI` (`lenders.path_id`): el equipo financiado es la garantía | por entidad (`ImeiValidationService`, `otp-validation.tsx`) |
| **Cuotas congeladas** | la entidad tiene una vigencia en `creditop_x_lender_freeze_periods` que cubre la hora actual de Colombia y es mensual (`cutoff_type_id = 1`), no rotativa y no `externally_serviced`: el crédito nace con sus primeras N cuotas (hasta 12) congeladas | por entidad (`InstallmentFreeze`) |
| **Codeudor** | la categoría del cliente en esa entidad tiene `requires_cosigner` | por cliente (`CosignerRequirementService`) |
| **Cuota inicial** | sólo CreditopX (riel 2 y 3): la categoría que le toca al cliente en esa entidad tiene `min_initial_fee` (en el rotativo, el crédito rotativo publica el porcentaje) | por cliente (`InitialFeePolicyResolver`) |

Por eso hay dos clases de variación: las **por entidad**, que se leen en la configuración y valen para
toda solicitud con esa entidad, y las **por cliente**, que dependen de la categoría que le toca y sólo
se saben al evaluarlo.

Las cuotas congeladas no agregan pantallas, pero cambian lo que muestran: las opciones de primera fecha
de pago se corren N meses (`PaymentDateService`), el plan de pagos lleva aparte las fechas de las
cuotas congeladas en $0 (`frozen_schedule`) y el crédito guarda `frozen_installments` y
`amortization_start_date` en `creditop_x_requests_history`, de lo que imprimieron los documentos y no
de la configuración al desembolsar. Mientras no empiece a amortizar no se le cambia la fecha ni el
plazo. Cada paso mira el flag en ese momento, así que si cambia con una solicitud a mitad de camino las
fechas que vio el cliente pueden no coincidir con el plan. La misma regla vive en `InstallmentFreeze`
de `legacy-application`, que causa el interés desde `amortization_start_date`: las dos cambian juntas.

Ábaco es una variación que además **trae datos**. Es un proveedor externo que, con las credenciales
que da el cliente, lee sus ingresos en plataformas como las de reparto o transporte: un ingreso
informal que las centrales no ven. Las pantallas aparecen después de elegir la entidad y antes de la
validación de identidad, sólo si la entidad lo pide. Lo que devuelve se usa de dos formas:

- **Ingreso:** `MonthlyIncomeResolver` evalúa las políticas con el ingreso formal (la primera central
  con monto: Ágil Data, Mareigua o Quanto) **más** el informal de Ábaco (campo 235). No recibe la
  entidad, así que el informal cuenta para toda entidad que evalúe a esa persona, no sólo para la que
  pidió Ábaco. La excepción es un perfil con `income_sources` en su fila de reglas: ahí sólo cuenta la
  primera de esas centrales con monto (`verifiedIncome`), sin Ábaco, Quanto ni el ingreso declarado.
- **Criterios propios:** las categorías pueden exigir viajes al mes o antigüedad en la plataforma, y
  negar a quien no tiene esos datos (`GigCriteria`).

La consulta vale por persona durante su vigencia, no por solicitud ([requisitos de
Ábaco](knowledge:abaco-requirements)).

El codeudor se decide por **rangos de la política**, no por una bandera de la entidad. Las categorías
de la etapa extendida (tipo 2) se evalúan en orden de prioridad y gana la primera cuyas reglas cumple
el cliente ([perfiles de una entidad](knowledge:lender-profile-rules)); el codeudor lo pide esa
categoría con `requires_cosigner`. Así, una entidad puede tener una categoría «directa» con un ingreso
mínimo alto y otra «con codeudor» con un ingreso mínimo más bajo: quien no alcanza el primer rango cae
en el segundo y se le pide codeudor. El ingreso que se compara es el total de `MonthlyIncomeResolver`,
así que el informal de Ábaco puede subir a alguien de rango. El codeudor se evalúa con su propio juego
de reglas, y su firma tiene recorrido aparte ([firma del codeudor](knowledge:cosigner-signature)).

La cuota inicial es además la variación que depende del canal. `InitialFeePolicyResolver` es su única
autoridad y sólo resuelve los tipos 2 y 3; con cualquier otro riel no hay cuota inicial. El porcentaje
sale de la categoría del cliente, y el monto suma lo que fija el convenio del comercio con la entidad
(`lenders_by_allieds`: gastos administrativos y fondo de garantía). En el rotativo se mide contra el
disponible del cupo; una vez autorizada, la compra ya está dentro de `used_limit` y el resolver le
devuelve su propio monto para no pedirle una cuota que no se debía. Cómo se cobra depende del canal:

- **Tienda:** el listado no ofrece el campo; si la entidad elegida exige cuota inicial y no hay pago
  aprobado, el backend frena la firma con `INITIAL_FEE_PAYMENT_REQUIRED` y el cliente paga por la
  pasarela antes de seguir (`ValidateInitialFeePaid`).
- **Asesor:** el campo aparece en el listado sólo si el comercio lo tiene activado
  (`allieds.initial_fee`). La firma no espera un pago por pasarela: fuera de la tienda la cuota inicial
  la cobra el comercio.

La cuota que exige la política puede no ser una que el cliente eligió: si el cupo bajó entre la oferta
y la firma, el resolver toma la diferencia como cuota inicial. Para eso, al elegir la entidad se guarda
la cuota que exigía la oferta (`OfferSnapshotRecorder`) y `OfferStillStandsGuard` la compara al armar y
confirmar el plan, al generar los documentos, al validar el OTP y al autorizar. Si ahora pide más, o si cambió el monto de compra desde la foto
(`original_amount` fuera de la tolerancia), responde 409 `OFFER_CHANGED` y el asistente vuelve al listado. En la tienda, `ValidateInitialFeePaid`
corre esa compuerta antes de pedir el pago. Con `initial_fee` mayor que 0, o sin foto, no compara.

## Campos: qué pide el formulario en cada comercio

Entre la variación y el ajuste hay una tercera clase: el **campo**, que cambia qué pide una pantalla sin
cambiar por dónde pasa la solicitud. Los de datos personales y empleo dependen del comercio o de la
sucursal, y cada uno se decide en un lugar distinto:

| campo | lo pide cuando | se decide en |
|---|---|---|
| **Fecha de expedición** | el comercio la recauda; sin fila o con la celda vacía, se recauda | `allieds.collect_expedition_date` (`OnboardingFieldsGate`) |
| **Fecha de nacimiento escrita** | el comercio es el 272, o la sucursal ofrece alguna de las entidades 39, 23, 141, 142, 166 o 24 | dos listas de ids en el código (`ManualPersonalDataAllieds`, copiadas en `ManualBirthDateConstants`) |
| **Estrato** | el comercio está en el setting `stratum_field_allieds` | `settings` |
| **Información laboral** | el comercio la recauda y las centrales no la dieron | `allieds.collect_employment_info` y la respuesta de las centrales |

La fecha de nacimiento tiene una consecuencia que no se ve en la pantalla. Si no se escribe, el backend
la **estima**: la fecha de expedición menos 18 años y un mes. Si el comercio tampoco recauda la
expedición, queda vacía. La edad que evalúan las reglas de edad de las categorías
(`LenderUserCategoryService`) depende de qué central validó a la persona: si fue Ágil Data, es la
edad que devuelve Ágil Data; si fue Mareigua o TusDatos, se calcula desde la fecha de nacimiento, y
entonces es la estimada, más baja cuanto más tarde se expidió el documento. Si el comercio no recauda
la expedición, el criterio de edad se salta. Las listas usan ids fijos, y el mismo id puede ser otro comercio en otra base.

La información laboral sale primero de las centrales. Si respondió Ágil Data o Mareigua, el backend
completa ocupación, ingreso y continuidad con el resumen de la que contestó (primero Ágil Data) y la
pantalla de empleo no se muestra. Si ninguna contestó, la pide el formulario (`ONB004`), salvo que el
comercio no la recaude. Los comercios de Corbeta reciben valores por defecto (1.500.000, empleado,
continuidad 3) en vez de la pantalla.

## El riel 4 paso a paso: qué es del riel y qué es de Credifamilia

Credifamilia es la primera entidad del riel 4 y el recorrido más largo: la entidad pone la política, y
Creditop pone las pantallas, los documentos, la firma y la entrega. Cada paso dice si sirve para
cualquier entidad del riel o si en `main` está atado a Credifamilia. Lo segundo es lo que una entidad
nueva del riel (Finandina) no hereda sola.

| paso | qué pasa | en `main` |
|---|---|---|
| **Preaprobación** | el asistente la pide por el `slug` de la entidad; decide el adaptador de `pre-approvals-service` con esa clave | del riel; el adaptador `credifamilia` es propio ([preaprobación](knowledge:credifamilia-origination)) |
| **Identidad** | los proveedores salen de la configuración de la entidad, con respaldo en orden (Credifamilia usa CrossCore y Evidente) | del riel, por configuración ([validación de identidad](knowledge:identity-validation)) |
| **Fecha de pago y plan** | opciones, fechas, cuotas y fianza | del riel, por perfil: las rutas `payment-plan/{lender_slug}/…` atienden a cualquier entidad tipo 4 por su `slug` (`DelegatedOriginationLenders::findBySlug`; 404 si no es del riel) y lo que cambia entre entidades (fuente y tipo de fianza, 4x1000, días de pago, fuente de insumos) se lee de `delegated_origination_profiles` (`DelegatedOriginationLenderProfile`). Una entidad del riel sin fila de perfil hace fallar el cálculo. Sigue atado: la única fuente de insumos registrada es la preaprobación de Credifamilia (`DelegatedOriginationInputsSources`), `payment-plan/credifamilia/calculate` es sólo de Credifamilia, y sin entidad explícita el cálculo cae a Credifamilia Salud (`CredifamiliaLenders::engineLenderIdFor`) ([rieles](knowledge:lender-response-types)) |
| **Formulario adicional** | un formulario dinámico antes de firmar; sus respuestas alimentan los PDF | del riel, por configuración (Credifamilia tiene el suyo) |
| **Documentos** | `pdf-mapper` llena los PDF (vinculación, fondo de garantías, plan de pagos, reglamento, términos y autorización de desembolso) con los datos del cliente y las respuestas del formulario | atado: `CredifamiliaDocumentsBuilder`, elegido por `CredifamiliaLenders::supports` y con la configuración de la entidad de Credifamilia |
| **Firma** | los documentos se firman con Netco | hay dos caminos: el fijo de Credifamilia y uno **configurable por entidad** (`netco_lender_settings` encendido, módulo SigningV1), que va antes |
| **Pagaré** | desmaterializado en Deceval, con la credencial de la entidad | del riel, por configuración ([pagaré](knowledge:deceval-promissory-note)) |
| **Autorización** | con el OTP de la firma, la solicitud pasa a estado 11 | del riel (de cualquier riel en casa) |
| **Formalización** | se entrega el crédito a la entidad | por perfil: la autorización lee `delegated_origination_profiles.formalization` y la resuelve con `DelegatedOriginationFormalizations`; sin formalización configurada no se radica. La única registrada es `credifamilia_radication`: `CredifamiliaFormalizationService` reúne y valida los documentos de Credifamilia (`collect`), pide a `LenderServiceFactory` el servicio de cierre de la entidad (`LenderFinalizationServiceInterface`; el de Credifamilia es la radicación SOAP) para fallar rápido, recién entonces los une en un PDF (`mergeUrlsToBase64`) y llama a `finalize` |

Lo que una entidad nueva del riel 4 necesita, entonces, cae en tres grupos. **Configuración**: el
`slug`, los proveedores de identidad, el formulario, la credencial de Deceval, la firma configurable y su
fila en `delegated_origination_profiles` (fianza, 4x1000, días de pago, fuente de insumos y
formalización). **Código propio**: su adaptador de preaprobación y, si no son las de Credifamilia, su
fuente de insumos y su formalización, cada una registrada por clave. **Generalizar lo atado**: los
documentos, que siguen siendo los de Credifamilia.

## Desenlace: cómo termina

Cada riel termina distinto:

- **Riel 0**: la entidad decide en su sitio; Creditop no sella el resultado.
- **Riel 1**: decide la integración de la entidad y lo informa.
- **Riel 2 y 3**: se autoriza en la plataforma y la solicitud llega al estado 11.
- **Riel 4**: se autoriza y, además, se **formaliza** ante la entidad. La formalización se elige por
  entidad: `LoanAuthorizationService`, después de confirmar la autorización, lee
  `delegated_origination_profiles.formalization` (`DelegatedOriginationLenderProfile`) y la resuelve con
  `DelegatedOriginationFormalizations`. La única clave registrada es `credifamilia_radication`
  (`CredifamiliaFormalizationService`, la radicación de Credifamilia). Sin formalización en el perfil no
  se radica y queda en el log; una entidad tipo 4 sin fila de perfil hace fallar la formalización
  (`InvalidArgumentException`).

La **cobranza** es otro eje del desenlace: `lenders.externally_serviced` dice si el ciclo de vida del
crédito lo gestiona Creditop o la entidad, independiente del riel.
