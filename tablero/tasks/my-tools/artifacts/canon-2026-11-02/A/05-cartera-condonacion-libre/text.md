**Además de la refinanciación y del paso a paz y salvo, el detalle del crédito en el monolito viejo tiene una condonación libre: quien la aplica elige qué saldos perdona y por cuánto.** Es el camino de los acuerdos de pago que autoriza el comercio. Exige el permiso de condonar saldos de créditos CreditopX y la fila vigente del crédito; el sistema nuevo no la tiene.

Se pueden condonar seis saldos: capital, intereses corrientes, interés de mora, seguro de vida, seguro de fianza y gastos de cobranza. Cada monto se topa al saldo vigente de ese ítem en la propia operación, no sólo en el formulario. Antes de aplicar, la pantalla muestra una simulación con el mismo cálculo. Una condonación de cero pesos que tampoco deja el crédito al día se rechaza.

El fondo de garantía no se elige: vive dentro del capital y, si se condona capital, se va con él la garantía que llevaba, en la misma proporción que en un pago ([[creditopx/context#un-pago-creditopx-cubre-el-minimo-en-cascada-y-el-sobrante-lo-decide-el-tipo-de-abono-salvo-con-mora]]). El saldo total resultante se recompone con capital, intereses, mora, seguros y gastos de cobranza.

**El estado del crédito sale de tres casos:**

- **Saldo total en cero:** queda en paz y salvo, sin exigible, sin mora y sin cuota.
- **Con saldo y la opción de dejarlo al día:** el pago mínimo, la mora y los días de atraso vuelven a cero y el crédito queda al día. Lo que no se condonó no desaparece: deja de ser exigible este período y se vuelve a facturar en el próximo corte, como en la [[#la-colilla-puede-condonar-el-minimo-de-cualquier-ciclo|condonación de colillas]].
- **Con saldo y sin esa opción:** conserva su estado y su mora, y cada componente del pago mínimo se recorta a lo que quedó de su saldo, para no seguir cobrando algo ya condonado.

Como en las otras condonaciones, los acumulados de lo pagado no cambian: no es dinero del cliente. El histórico recibe una fila con el movimiento «condonación por acuerdo de pago autorizado por el comercio», y la bitácora de CreditopX guarda quién la hizo, el detalle por ítem, el saldo total antes y después, y el cambio de días de mora y de estado. Algunas correcciones del sistema reutilizan esta misma operación con un movimiento propio, para no quedar registradas como algo que autorizó el comercio.
