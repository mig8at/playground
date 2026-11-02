# Perfiles de una entidad: orden, criterios y bloqueos del cupo

Una entidad de riel 2 a 4 decide cuánto prestarle a un cliente con **perfiles** (categorías,
`lender_users_categories`) y sus **reglas** (`lender_users_category_rules`): la primera regla que el
cliente cumple le asigna la categoría, y de la categoría cuelgan cupo, plazo máximo, cuota inicial y
tasa. Este tema cubre, en legacy-backend, el orden de evaluación, cómo se convierte la capacidad en
cupo, criterios que no se leen como parecen (continuidad laboral, licencia, Ábaco) y lo que niega
el cupo antes de mirar perfiles. El alta de perfiles está en `creditopx-setup-diagnosis`; el puntaje
por respuestas, en `field-scoring-policy`; la tarjeta de oferta, en `creditopx-offer-calculation`.
Lo de legacy-application no se revisó acá.

## Gana la primera regla que se cumple

Las reglas de la entidad se ordenan por `priority` y, a igual prioridad (o todas en NULL, que es lo
habitual), por `lender_users_category_id`. Sólo entran las reglas de categorías **activas**: un perfil
que ya asignó clientes no se borra, se apaga con `lender_users_categories.active`, y deja de evaluarse
sin perder el historial que explica decisiones pasadas. Cada etapa tiene su juego de reglas por
`lender_users_category_type_id`: titular inicial (1), titular extendida (2, la que tiene formulario) y
codeudor.

Qué categoría quedó se lee en `users_category_log` (la fila más reciente por entidad; 0 es «ninguna»), y
se comprueba corriendo con `make harness-suite TARGET=local SUITE=harness/suites/categorias-creditopx.json`,
que mueve un dato del buró por caso (consultas, tarjetas, negativos, meses de aportes).

## De la capacidad mensual al cupo

La capacidad mensual del perfil se convierte en cupo con la fórmula de anualidad sobre el plazo
máximo a la tasa de la entidad: cuánto capital aguanta esa cuota. Si la categoría declara
`available_amount_multiplier`, **el multiplicador manda** y la fórmula no corre: el cupo es N veces la
capacidad mensual, sin depender de tasa ni plazo. Es una decisión comercial por categoría.

Cuando la entidad tiene otorgamiento especial (el cálculo de DENTIX/DFS), ese monto reemplaza al cupo
del perfil, pero se topa con el `max_amount` de la categoría si está configurado mayor que 0.

## La continuidad laboral va por escalones

El motor no mide meses de continuidad: los deriva de banderas de AgilData (o, si no hay, de Mareigua)
y sólo puede valer 12, 6, 3 o 0. Una regla que pide 8 meses exige en la práctica 12, y una que pide
más de 12 no la cumple nadie. Sin datos, la continuidad es 0.

## Vigencia de la licencia, sólo en la etapa extendida

`min_license_validity_years` sólo se evalúa en reglas de la etapa extendida (tipo 2) con un valor
mayor que 0; en la etapa inicial se ignora porque no hay formulario. La fecha de vencimiento se lee
de la respuesta del formulario dinámico en el campo `license_expiry_field_id`, y la licencia debe
vencer en o después de hoy más N años. Sin campo configurado, sin solicitud o sin respuesta, la regla
**niega**: exige la vigencia y no hay con qué comprobarla.

## Cuándo se ofrece saltar Ábaco

«Continuar sin validar» el paso de Ábaco se ofrece (y el salto se acepta) si la entidad no tiene
reglas de etapa extendida, o si **alguna** de ellas deja pasar sin datos de Ábaco. Una regla niega
sin datos cuando configura viajes mensuales o antigüedad en plataforma **y** marca
`reject_without_gig_data`. Es por entidad y no por persona: antes de evaluar no se sabe en qué
categoría caerá el cliente. El resto del requisito está en `abaco-requirements`.

## Lo que niega el cupo antes de mirar perfiles

`available-quota` (y sus variantes de etapa extendida y codeudor) rechaza antes de evaluar reglas:

- **`lender_not_creditop_x`** si la entidad es de riel 0 o 1: no tienen cupo financiado por Creditop.
- **`active_credit_exists`** si el cliente ya tiene con **esa misma entidad** de riel 2 un crédito
  vivo (fila vigente del histórico) con saldo de capital de $1.000 o más. Por debajo se trata como
  residuo y no bloquea. Otras entidades y el rotativo no cuentan.

## La periodicidad de corte se congela

En el backoffice, el tipo de corte de una entidad deja de poder cambiarse: siempre en un rotativo,
porque el cupo y todas sus compras se facturan con ese corte, y en consumo apenas la entidad originó
un crédito, porque cambiarlo movería las fechas de pago de créditos firmados.
