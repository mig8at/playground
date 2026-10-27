**El primer guardado del perfilamiento clasifica; los siguientes registran lo que respondió cada entidad.** Al armar el listado se guarda en `profiling_reviews.displayed_lenders` cada entidad con su probabilidad, su `weighted_score` y su monto. Después, el asistente nuevo manda una foto de lo que ve el cliente cada vez que terminan de resolverse las consultas de preaprobación: al terminar la carga y después de cada reintento exitoso.

**Esa foto reemplaza la revisión entera.** La revisión vigente se archiva y la nueva lleva exactamente las entidades de la foto. Una entidad que el asistente ocultó (por su respaldo, por el filtro de Welli Risk o por un error del servidor) no queda como «Rechazado»: desaparece de la revisión. El comentario del endpoint dice que las ausentes quedan rechazadas, pero el código las descarta.

**Cada entidad de la foto conserva el `weighted_score` y el porcentaje del primer guardado**, y su resultado se reescribe:
- aprobada: «Pre aprobado», o el texto que mande el asistente, con su monto;
- cualquier otro estado: monto 0, con la etiqueta que muestra su tarjeta: «Rechazado», «Sin cupo disponible», «No elegible por cupo desembolsado», «No consultado por políticas internas» o «error». Sin estado propio, conserva la probabilidad original.

Así, «Probabilidad alta» en el primer guardado y «Rechazado» con monto 0 en el último no se contradicen: la primera es la clasificación del perfilamiento; la segunda, la respuesta de la entidad o del motor CreditopX a la consulta ([[listado/context#la-probabilidad-clasifica-no-significa-que-se-paso-la-politica-dura]]). El motivo se busca en esa consulta, no en el puntaje.

El resultado de una sola entidad (el aviso asíncrono de Credifamilia, la vuelta de Cuotéalo o el endpoint de un resultado) se aplica igual, pero sobre la revisión vigente y sin sacar a las demás.
