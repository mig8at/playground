# knowledge: cómo funciona CreditOp por dentro (la biblioteca local, escrita desde el código)

Los temas explican el MECANISMO —clases, tablas, reglas— y cada sección está respaldada por archivos de `main`.

| comando | para qué |
|---|---|
| `make knowledge-map` | todos los temas con su id y su resumen: empezá acá si no sabés qué tema mirar |
| `make knowledge-search Q='palabras'` | las secciones que mencionan algo (el `id#ancla` de cada una) |
| `make knowledge-read ID=tema` · `make knowledge-read ID=tema#ancla` | un tema entero, o sólo una sección (más barato) |

```comando
make knowledge-search Q='cupo mensual'
make knowledge-read ID=creditopx-quota
```

- Si ya sabés el id de un tema, leelo: no lo busques. `knowledge-search` es para cuando no sabés en qué tema está
  algo, y se busca por palabras del negocio («cupo mensual»), no por el id.
- Suelen hacer falta: `business-overview` (quién es quién, canales, estados), `lender-listing` (qué entidades le salen
  a un cliente), `creditopx-quota` (el cupo mensual), `kyc-pipeline` (la validación de identidad),
  `ecommerce-context` (las tiendas online).
- El silencio de la biblioteca no es «no existe»: sólo sabe lo que alguien escribió. Si no está, decilo y, si hace
  falta, mirá el código (`ayuda codigo`).
