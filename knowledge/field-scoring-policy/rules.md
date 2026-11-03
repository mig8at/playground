# Categoría por puntaje de respuestas

Cómo el backend modular asigna una categoría de usuario sumando puntos por las respuestas del
formulario y por la capacidad de pago, y cómo el formulario dinámico convierte rangos declarados en
montos. Describe `legacy-backend` en las refs de `sources.json`; `application` no tiene este camino.
Qué entidad o país lo usa, sus puntajes y sus categorías son configuración del ambiente. El código
lo menciona como la categorización de SmartPay.

## Cuándo se usa el puntaje

`LenderUserCategoryService` prueba primero las reglas de categoría de la entidad. Si una aprueba,
la categoría sale marcada `matched_by_rule = true`. Si ninguna aprueba, suma puntos:

- Por cada fila de `lender_user_fields_scoring_policy` de la entidad y el tipo, suma su puntaje
  cuando el último valor del campo del usuario es igual (`==`) al valor configurado.
- Suma el puntaje de capacidad de pago (sección siguiente).
- Con el total, `lender_user_category_scoring_policy_rules` elige la categoría por rango de puntaje.
  El plazo máximo y la inicial mínima son los de esa categoría.

Si ningún rango coincide, se registra un rechazo con categoría 0 y la entidad no tiene categoría.

## La respuesta se compara como texto

La comparación es el `==` de PHP entre el valor guardado de la respuesta y el `value` de la fila de
política. Entre textos no numéricos es igualdad exacta, carácter por carácter: un guion «-» y una
raya «–», un acento, un espacio o una mayúscula distintos hacen que no coincida. No hay
normalización ni catálogo compartido entre las opciones del formulario y las filas de política.

Si la política nombra una opción que el formulario no ofrece, o el formulario guarda un texto que la
política escribe distinto, esa respuesta suma 0 sin error ni registro: el usuario cae en una
categoría más baja o en ninguna, y nada distingue ese caso de una respuesta que no puntúa.

## La capacidad de pago

`calculatePaymentCapacity` toma el ingreso del mismo resolvedor de ingreso mensual que la política y
el gasto del último valor del campo 90, y calcula `floor((ingreso − gasto) / ingreso × 100)`.
`evaluatePaymentCapacityScoring` busca en `lender_payment_capacity_scoring_policy` el rango que
contenga `100 −` ese número: el porcentaje del ingreso que se va en gastos.

- Con ingreso 0 o menor, la capacidad vale 0 y el valor buscado es 100: se puntúa como si todo el
  ingreso se fuera en gastos, no como capacidad 0.
- Sin campo 90, el gasto cuenta como 0: la capacidad es 100, el valor buscado es 0 y cae en el
  rango que la entidad configuró para el menor gasto.
- Con gastos mayores que el ingreso, el valor buscado pasa de 100. Si supera el máximo de todos los
  rangos configurados, ninguno coincide y la capacidad suma 0.

La búsqueda (`getScoreByCapacityAndType`) filtra por entidad y tipo con `min <= valor <= max`, con
los dos límites inclusivos, y toma `first()` sin `orderBy`. Si dos rangos comparten un borde o se
pisan, el puntaje de un valor en la zona compartida depende del orden en que la base devuelva las
filas.

## Una categoría por puntaje no siempre aprueba

La categoría que sale del puntaje queda con `matched_by_rule = false`. Si la entidad no tiene reglas
pero sí política de puntaje, la categoría lleva además `scoring_is_primary = true`. La guarda que
descarta la categoría por puntaje cuando la entidad sí tiene reglas (`matched_by_rule === false` y
sin `scoring_is_primary`) sólo la aplican el cupo de CreditopX y el sello de aprobación CreditopX
del listado v2 (`LenderListingService::stampCreditopXApproval`). Ahí es un respaldo que no cuenta
como aprobación.

## Dónde se usa sin la guarda

Otros consumidores de `getLenderUserCategory()` toman la categoría tal como sale, sin mirar
`matched_by_rule` ni `scoring_is_primary`, así que una categoría por puntaje de respaldo les rige
igual que una por regla:

- El listado v1 (`GET lenders/{user_request_id}` → `ListLenderController` →
  `LenderRetrievalService`) aplica a cada entidad CreditopX el plazo máximo, la inicial mínima, la
  tasa y el monto disponible de la categoría. Sólo quita la entidad si no hay categoría o si el
  monto disponible es menor que el mínimo de su línea.
- El fondo de garantía (`GuaranteeService`) toma el FGA de la categoría.
- La inicial (`InitialFeePolicyResolver`) toma la inicial mínima, el FGA y el monto disponible.
- El codeudor (`CosignerRequirementService`) toma `requires_cosigner`.

La decisión de otorgamiento (`GrantingCategory`) registra `resolved_by = 'scoring'` para toda
categoría sin `matched_by_rule`, sea respaldo o política primaria.

## Rangos declarados que se vuelven montos

El formulario dinámico guarda cada respuesta en su campo (162 a 172: ciudad, ingreso promedio,
ocupación, captura del número de asociado, tipo de ingreso, antigüedad, canales, créditos activos,
tarjeta, gasto aproximado y moras de más de 30 días). Además convierte el ingreso y el gasto
declarados en montos para los campos 87 y 90, que leen el resto de las políticas
(`extractAmountUpperBound`):

- Un número se guarda tal cual.
- Si el texto tiene un marcador de tope inferior («menos de», «hasta», «under», «below», «up to»),
  guarda el número más chico del texto menos 5000. Este marcador se mira primero.
- Si tiene un marcador de rango abierto («más de», «o más», «sin techo», «sin límite», «no tiene
  techo», «above», «greater than», «over », o un `+` al final), guarda 65000 para el ingreso y
  55000 para el gasto.
- Si no, guarda el último número que aparece en el texto, no el mayor.

Esos montos son estimaciones del rango que declaró el cliente, no ingresos verificados.
