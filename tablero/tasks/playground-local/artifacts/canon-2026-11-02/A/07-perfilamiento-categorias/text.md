**El orden de las categorías, la conversión de capacidad en cupo y algunos criterios no se leen como parecen, y los dos monolitos no coinciden en todos.**

**Orden.** Las reglas de la entidad se recorren por prioridad y, a igual prioridad o con todas vacías, por el número de la categoría. Gana la primera que se cumple entera. Cada etapa tiene su propio juego de reglas: titular inicial, titular extendida (la que tiene formulario) y codeudor.

**Categorías apagadas.** Un perfil que ya asignó clientes no se borra: se apaga, y conserva el historial que explica decisiones pasadas. El monolito nuevo sólo evalúa las reglas de categorías activas. El viejo no mira esa marca: sigue evaluando las reglas de una categoría apagada.

**De la capacidad al cupo.** Por defecto, la capacidad mensual se convierte en cupo con la fórmula de anualidad sobre el plazo máximo de la categoría a la tasa de la entidad: cuánto capital aguanta esa cuota. Si la categoría declara un multiplicador de cupo, **el multiplicador reemplaza a la fórmula**: el cupo es N veces la capacidad mensual, sin depender de tasa ni plazo. Los dos monolitos lo aplican igual. El otorgamiento especial de DENTIX sigue su propia regla: [[#el-otorgamiento-especial-de-dentix-reemplaza-el-cupo-de-la-categoria-y-sus-topes-por-score-estan-en-el-codigo]].

**Continuidad laboral por escalones.** El motor no mide meses: los deriva de las marcas de 12, 6 y 3 meses de la fuente de empleo, así que sólo puede valer 12, 6, 3 o 0, y sin datos vale 0. Una regla que pide 8 meses exige en la práctica 12, y una que pide más de 12 no la cumple nadie. Es igual en los dos monolitos.

**Vigencia de la licencia.** Sólo el monolito nuevo la evalúa, y sólo en reglas de la etapa extendida con un número de años mayor que cero; en la inicial se ignora porque no hay formulario. La fecha se lee de la respuesta del formulario dinámico en el campo que configura la regla, y la licencia debe vencer en o después de hoy más esos años. Sin campo configurado, sin solicitud o sin respuesta, **la regla niega**: exige la vigencia y no hay con qué comprobarla.

**Lo que niega antes de mirar categorías** en la consulta de cupo del monolito nuevo:

- una entidad referida o integrada por API (tipos 0 y 1) se rechaza como entidad no CreditopX: su cupo no lo financia Creditop;
- un crédito vivo del cliente **con esa misma entidad de consumo**, con saldo de capital de mil pesos o más, rechaza por crédito activo; por debajo se trata como residuo. Los créditos con otras entidades y los de un cupo rotativo no cuentan: [[creditopx/context#un-credito-activo-bloquea-el-siguiente-por-entidad-no-por-comercio]].
