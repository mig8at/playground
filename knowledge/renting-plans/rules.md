# Planes de renting y RTO

Mecanismo del backend modular y del wizard disponible en las refs locales de `main`. No certifica tarifas, configuración de un ambiente, despliegues ni la interpretación comercial o legal del contrato. Las fórmulas y los planes concretos son datos de cada entidad; no se adopta el ejemplo de Motai como regla general.

## Producto y calculadora

`lenders.product` distingue `credit`, `renting` y `rto`; `calculator` contiene parámetros, fórmulas y opciones. El modelo modular castea la calculadora a array. `LenderListingService` adjunta `product` y `calculated` usando `LenderCalculator`. Sin fórmulas, `FormulaCalculator` devuelve los inputs. El producto por sí solo no inventa una matriz de planes. El admin de entidades de `legacy-application` revisado no guarda `product` ni `calculator` en su `update`: crear o editar allí una entidad no prueba que tenga oferta calculada.

## Orden y errores de las fórmulas

El formato que conserva la secuencia es `formulas: [{"name":"amount","expression":"..."}, ...]`. Cada resultado entra al scope de la siguiente fórmula; los inputs pisan los parámetros. También se acepta el objeto antiguo, pero una configuración encadenada necesita un orden explícito. El evaluador restringe las expresiones a aritmética y rechaza llamadas a función o resultados no numéricos. El evaluador y `LenderCalculator` pueden lanzar: el degradado a `{amount}` pertenece al `catch` del listado, no a todos sus consumidores. Una tarjeta sin planes puede ser una configuración vacía o un cálculo fallido; no demuestra que el producto sea crédito.

## Opciones y cantidad de pagos

`LenderCalculator` elige primero `plans` y luego `terms` cuando son arrays; un `plans: []` también gana sobre `terms`. Corre las fórmulas por cada fila válida e incorpora sus valores numéricos como inputs. Los escalares se toman de la primera fila, mientras `payment` queda por opción y se redondea a entero. Si una fórmula de monto depende de una variable de fila, el monto común seguirá siendo el de la primera. La cantidad de pagos sale de `count` y, si falta, de `weeks`; no convierte `months` automáticamente. Una fila sin ninguno de los dos queda sin conteo, sin error en el listado. `fee_number` identifica la opción por esa cantidad: dos planes con el mismo conteo no quedan distinguidos por este mecanismo. `LenderCalculation` devuelve la misma clave de matriz, `payment_unit` (default `weekly`), la inicial calculada antes que la fija y el default explícito si existe.

## Tarjeta y selección del plan

El wizard reconoce una oferta de calculadora por `calculated.plans` no vacío, con renting/RTO como respaldo cuando el cálculo se degrada. `CalculatorLenderCardContent` lee `plans`; no normaliza `terms` a `plans`. Por eso emitir `terms` desde el backend no basta para obtener ese selector. El selector aparece sólo con más de un plan. El plan activo se busca por `count ?? weeks`, luego por `default_plan`, y finalmente por la primera fila. La elección se guarda en el store de cuotas para el envío de `fee_number`; elegir otra fila no vuelve a calcular la fórmula. La etiqueta dice pago semanal cuando `payment_unit === "weekly"`. El total de la tarjeta lo esconde `card.hide` cuando el backend manda ese bloque; sin él, el renting lo esconde y el RTO lo muestra. Renting y RTO ocultan los chips de preaprobación y cupo en los caminos inicial y aprobado; la resolución de baja probabilidad conserva el mensaje «Sin cupo disponible». Esa presentación no reemplaza la evaluación de elegibilidad.

## Recálculo por monto

`recalculate` consulta entidades activas asociadas a la sucursal y vuelve a calcular su oferta; no ejecuta el pipeline completo de listado, buró o preaprobación. Sin solicitud o sucursal devuelve una lista vacía. Si hay total de pedido ecommerce, ese total manda sobre el monto recibido; el controller devuelve el monto efectivo. En el wizard el cambio de monto dispara la ruta de recálculo con 450 ms de debounce y reemplaza sólo el `calculated` de las entidades ya listadas; el repositorio toma `data.lenders` y descarta el monto efectivo que devuelve el controller. El indicador arranca al editar y termina cuando el fetcher vuelve a idle, incluso si no llegaron datos. El bridge sólo cambia el indicador de entidades con `calculated` y lo limpia al desmontar. La ruta del wizard devuelve `{lenders:{}}` ante monto inválido o error. El recálculo no prueba que todas las entidades sigan siendo elegibles para el nuevo monto.

## Simulación y documentos

`CalculatorPaymentScheduleService::supports` decide por una matriz configurada, no por el nombre del producto. La simulación reutiliza `LenderCalculator`, toma `original_amount` con fallback a `amount` e incorpora el porcentaje de inicial de la categoría. El listado no pasa ese input adicional; compartir evaluador no garantiza importes iguales con bases o inputs distintos. El calendario depende del corte y de la fecha de pago elegida, separado de la etiqueta `weekly` del resultado. Con matriz pero sin filas válidas, `simulate` responde 422; una fórmula que lanza llega al controller como 500. Una opción sin `count` ni `weeks` sale con `fee_number` 0 y `schedule` vacío, y el backend responde 200; el wizard exige al menos un pago en el `schedule` de cada opción, así que toda la respuesta falla como `INVALID_PAYLOAD` y el loader de la pantalla `payment-schedule` lanza un error que termina en 500. Para documentos, `CatalogDocumentPayloadResolver::builderClassFor` decide en el orden plantilla, slug, producto y onboarding (`CatalogDocumentPayloadResolver.php:172`): primero el prefijo de `lender_signing_documents.template` (hoy sólo `creditopxpdf.lenders.alta.`, Alta Fleet, porque su slug cambia entre ambientes), después el slug con builder propio y después el producto renting/RTO; el resto cae a onboarding. Una fila sin plantilla sigue la regla por slug y producto, así que una entidad `rto` sin plantilla ni slug propios recibe el builder de Motai. Un lender que lista y simula todavía necesita un catálogo y plantillas compatibles para firmar. Ninguno de estos archivos demuestra que esas filas estén cargadas en un ambiente.

## Montos que se guardan al autorizar

`CalculatorAuthorizationAmounts` decide los montos de autorización de las entidades cuyo `calculator`
declara una matriz de opciones. Devuelve `null` —y la autorización sigue por el cálculo de crédito de
siempre— sin matriz, si el cálculo lanza, si no quedan opciones o si no hay fórmula `amount`. Con
resultado, `final_amount` es el precio calculado (el resultado de la fórmula `amount`), no el costo: el
histórico lo carga al cupo mensual de la categoría y, en rotativos, a `used_limit`. `fee_value` es el
pago periódico del plan cuyo conteo coincide con `fee_number`; si ninguno coincide, el del default, y
sin default queda en 0. En el histórico del crédito, `total_amount` toma el mismo precio, `fee_value`
el pago periódico y `next_payment_date` la misma ancla que la simulación: `selected_payment_date` si ya
se confirmó, o la que calcula el corte de la entidad. `LoanAuthorizationService` lo aplica al autorizar,
al numerar la solicitud que queda esperando la firma del codeudor y al reanudarla; el desembolso IMEI
sigue con `calculateAmounts()`. La regla
depende de la configuración, no de `product`: una entidad de crédito con matriz de opciones seguiría
este camino.
