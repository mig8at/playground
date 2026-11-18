# sentinel: cómo está producción (el vigía: entidades, comercios, servicios y pantallas contra lo normal)

| comando | para qué |
|---|---|
| `sentinel now` | cómo está producción ahora: lo que pide atención, lo que se sigue y cada servicio |
| `sentinel day` · `sentinel day 2026-11-12` | el resumen de un día: qué se salió de lo normal y a qué hora, los despliegues y los avisos |
| `sentinel deploy repo` · `sentinel deploy repo versión` | ¿empeoró algo después de un despliegue a producción? |

```command
sentinel now
sentinel day
```

- «Lo normal» es la misma hora en los días comparables. En solicitudes lo malo es que CAIGAN; en errores, que SUBAN.
  `✗` es alerta, `!` es «para mirar».
- Que algo empeore después de un despliegue no prueba que lo causó: mirá si en el «antes» ya estaba mal.
- Un comercio chico puede dar un número bajo por azar: pesá el tamaño. Una entidad (presta) no es un comercio (vende).
- Te llegan agregados, nunca datos de clientes ni el texto de los errores. Para el detalle de cómo decide, `guide sentinel`.
