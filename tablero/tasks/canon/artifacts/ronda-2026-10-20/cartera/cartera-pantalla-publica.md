**Un cliente de CreditopX paga por su cuenta en la pantalla pública de pago: escribe su documento, elige el crédito y paga por la pasarela, sin iniciar sesión.** Qué medio queda anotado en cada pago lo explica [[cartera/context#el-medio-de-pago-no-dice-como-pago-el-cliente]].

La pantalla es una sola: la aplicación de pagos aparte, que busca los créditos de consumo activos del cliente y todos sus cupos rotativos contra un servicio público. El servicio devuelve cada crédito con su entidad, su próxima fecha de pago y si se puede pagar.

Las direcciones de pago de cuotas del sistema viejo ya no muestran nada propio (la cuota inicial todavía se cobra desde el viejo): la consulta por documento, la lista de productos de un cliente y el cobro de un crédito redirigen a la aplicación de pagos, a su búsqueda o directo al crédito de consumo o al cupo rotativo cuando la dirección lo identifica. El enlace de pago que se envía o se copia desde los paneles del viejo también apunta a la aplicación: al cupo si lo trae, si no al crédito de consumo y, sin ninguno de los dos, a la búsqueda. La dirección de la aplicación es configuración del viejo.

Que un crédito se pueda pagar depende de la credencial de pasarela del punto de venta donde nació. Si la sucursal no tiene credencial propia se usa la del comercio, y la credencial debe tener sus tres llaves completas. Un cupo rotativo toma la sucursal de su compra más reciente; un cupo sin compras no se puede pagar.

Cómo se aplica después un pago al rotativo está en [[cartera/context#un-pago-por-pasarela-al-rotativo-va-al-cupo-de-la-transaccion]].
