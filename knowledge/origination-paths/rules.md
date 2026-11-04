# Recorrido de una solicitud: canal, riel y variaciones

Un **recorrido** es el camino que sigue una solicitud desde que entra hasta que termina. Se describe con
siete piezas que no se mezclan: **canal**, **tramo común**, **riel**, **producto**, **variaciones**,
**ajustes** y **desenlace**. Con ellas se puede decir de un cambio si cae en un recorrido que ya existe,
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
| **Aprobación manual** | la entidad tiene `lender_requirements.manual_approval`: un asesor aprueba antes de seguir | por entidad |
| **IMEI** | la entidad tiene la ruta `IMEI` (`lenders.path_id`): el equipo financiado es la garantía | por entidad (`ImeiValidationService`, `otp-validation.tsx`) |
| **Codeudor** | la categoría del cliente en esa entidad tiene `requires_cosigner` | por cliente (`CosignerRequirementService`) |
| **Cuota inicial por pasarela** | sólo en el canal tienda: la política de la categoría exige cuota inicial y no hay pago aprobado, así que el backend frena con `INITIAL_FEE_PAYMENT_REQUIRED` y el cliente paga antes de firmar | por cliente (`ValidateInitialFeePaid`, `InitialFeePolicyResolver`) |

Por eso hay dos clases de variación: las **por entidad**, que se leen en la configuración y valen para
toda solicitud con esa entidad, y las **por cliente**, que dependen de la categoría que le toca y sólo
se saben al evaluarlo. Una variación también puede depender del canal: fuera de la tienda la cuota
inicial la cobra el comercio y no pasa por la pasarela, así que no cambia el camino.

## Desenlace: cómo termina

Cada riel termina distinto:

- **Riel 0**: la entidad decide en su sitio; Creditop no sella el resultado.
- **Riel 1**: decide la integración de la entidad y lo informa.
- **Riel 2 y 3**: se autoriza en la plataforma y la solicitud llega al estado 11.
- **Riel 4**: se autoriza y, además, se **formaliza** ante la entidad. En `main`,
  `LoanAuthorizationService` formaliza todo tipo 4 con `CredifamiliaFormalizationService`, la
  radicación de Credifamilia: la formalización todavía no se elige por entidad.

La **cobranza** es otro eje del desenlace: `lenders.externally_serviced` dice si el ciclo de vida del
crédito lo gestiona Creditop o la entidad, independiente del riel.
