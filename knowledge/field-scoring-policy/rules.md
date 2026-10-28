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
  cuando el último valor del campo del usuario es igual (`==`) al valor configurado. Una opción del
  formulario que cambie de texto deja de coincidir y suma 0, sin error.
- Suma el puntaje de `lender_payment_capacity_scoring_policy` cuyo rango contenga
  `100 − floor((ingreso − gasto) / ingreso × 100)`: el porcentaje del ingreso que se va en gastos. El
  ingreso sale del mismo resolvedor de ingreso mensual que la política; el gasto, del campo 90. Con
  ingreso 0, la capacidad cuenta como 0.
- Con el total, `lender_user_category_scoring_policy_rules` elige la categoría por rango de puntaje.
  El plazo máximo y la inicial mínima son los de esa categoría.

Si ningún rango coincide, se registra un rechazo con categoría 0 y la entidad no tiene categoría.

## Una categoría por puntaje no siempre aprueba

La categoría que sale del puntaje queda con `matched_by_rule = false`. Si la entidad también tiene
reglas de categoría para ese tipo, el cupo de CreditopX y el listado la rechazan: es un respaldo que
no cuenta como aprobación. Si la entidad no tiene reglas pero sí política de puntaje, la categoría
lleva `scoring_is_primary = true` y cuenta como aprobada.

## Rangos declarados que se vuelven montos

El formulario dinámico guarda cada respuesta en su campo (162 a 172: ciudad, ingreso promedio,
ocupación, tipo de ingreso, antigüedad, canales, créditos activos, tarjeta, gasto aproximado y
moras de más de 30 días). Además convierte el ingreso y el gasto declarados en montos para los
campos 87 y 90, que leen el resto de las políticas:

- Un número se guarda tal cual.
- Un rango guarda el número más alto que contiene.
- «Menos de X» guarda X − 5000.
- «Más de …» guarda 65000 para el ingreso y 55000 para el gasto.

Esos montos son estimaciones del rango que declaró el cliente, no ingresos verificados.
