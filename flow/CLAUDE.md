# Flow — contexto para un modelo

`flow` es un **simulador explicable**, no producción ni un catálogo real de comercios. Desde la raíz
de `playground`, para una pregunta general el modelo entra por una consola compacta y local:

```sh
make flow-context ARGS='map --text'
make flow-context ARGS='route "¿Por qué una entidad baja de prioridad?" --text'
make flow-context ARGS='brief branch-gate --text'
```

El recorrido es siempre **mapa → una ficha → fuente declarada**. La ficha no sustituye la evidencia;
sólo evita abrir los documentos grandes cuando todavía no se sabe qué regla importa. No enviarle a
este comando cédulas, teléfonos, solicitudes, SQL, logs o datos de un caso. Para eso corresponden
`harness` (ejecutable) y `trazador` (hechos de una solicitud).

La frontera debe quedar explícita: una regla representada por Flow ayuda a explicar y probar una
hipótesis; no prueba el comportamiento actual de producción. Cuando la ficha diga que la fidelidad
es parcial, se abre su fuente o se corre la herramienta correspondiente.
