**La compuerta decide si se le pide la preaprobación a una entidad, y sólo existe para las entidades marcadas con `lenders.requires_preapproval_gate`** (hoy Prami, que cobra la consulta). La resuelve el listado del monolito nuevo, en la puerta `lenders-v2`, y viaja a la pantalla como `can_check_preapproval`. El monolito viejo no tiene compuerta.

**Una entidad sin la marca sale siempre habilitada**, y ningún camino del listado la puede bajar. **Una entidad con la marca empieza deshabilitada** y sólo se habilita si el cliente pasa **las tres** partes de la regla de datacrédito que la sucursal tiene para esa entidad: score mínimo, máximo de cuentas negativas y antigüedad en el sector financiero. Cada parte cuenta como pasada sólo si se pudo evaluar: un dato ausente del cliente la deja sin pasar.

Por eso la marca falla cerrada en todos los caminos donde no hay evaluación:

- la sucursal no tiene regla de datacrédito para esa entidad;
- el comercio no tiene frecuencia de consulta de centrales, o el cliente no tiene score, y el paso que evalúa la regla no corre ([[listado/context#el-score-minimo-de-la-regla-de-datacredito-solo-excluye-en-creditopx-y-el-listado-nuevo-no-saca-a-nadie-por-el]]);
- la entidad ya quedó en «Probabilidad muy baja» o «0% de probabilidad» por las reglas duras, que se saltan la regla de datacrédito.

La marca es por entidad; la regla que la habilita, por sucursal. Activar la compuerta para una entidad sin cargarle la regla en cada sucursal la deja sin consultar en todas.

**Del lado de la pantalla, sólo un `false` explícito bloquea**: verdadero o ausente consultan, para que un ambiente con el backend sin la compuerta no apague todas las consultas. Las variantes de Welli están exceptuadas porque comparten una sola consulta. A una entidad bloqueada la pantalla no la consulta: le asigna directamente un estado terminal y la tarjeta queda visible pero inerte, con «No disponible para tu perfil», sin selección ni reintento. Es distinto de una consulta que falló, que sí ofrece reintentar. El reintento manual usa el mismo criterio, así que no sirve para saltarse la compuerta.

Una opción puede seguir visible con la consulta deshabilitada. Las [[creditopx/context#el-rechazo-desaparece-sin-mensaje-y-no-es-una-falla|reglas de grupo de CreditopX]] resuelven otra decisión: retirar una opción del listado. Los [[listado/context#una-entidad-se-cae-del-listado-en-muchos-puntos-distintos-y-el-mas-denso-descarta-sin-consultar|demás filtros del listado]] también tienen su propio efecto.
