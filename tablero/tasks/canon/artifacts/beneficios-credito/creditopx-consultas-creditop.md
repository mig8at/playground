**El monolito nuevo puede descontar las consultas de Creditop del número de consultas de los últimos 6 meses**, sólo en entidades CreditopX: consumo (tipo 2, también las que gestionan su cartera afuera) y rotativo (tipo 3). Ahí la consulta de Creditop es parte del mismo estudio. Las entidades del marketplace ven esas huellas al estudiar al cliente: su política las sigue contando.

**Está detrás de un interruptor que nace apagado:** la fila `exclude_creditop_inquiries` de `settings` con `{"enabled": true}`. Sin la fila, o si no se puede leer, todo cuenta como antes. Prendido o apagado, se registran las consultas del reporte, las de Creditop y si se descontaron.

Las de Creditop se reconocen por su NIT en las huellas de consulta del reporte de Experian, en la misma ventana de 6 meses. Se restan al número que reporta Experian, sin bajar de cero. Si el reporte no trae huellas o fecha de consulta, se evalúa el número de Experian.

**Aplica en:** las reglas de buró al pedir cupo de consumo y al pedir un cupo rotativo nuevo, el criterio de consultas de los perfiles de consumo, la variable de consultas del cálculo del rotativo y el simulador de reglas del backoffice.

**No aplica en el listado** ni en el monolito viejo. El viejo cuenta todas las consultas en su listado y en sus perfiles: con el interruptor prendido, puede sacar del listado una entidad que el nuevo no rechazaría por consultas.
