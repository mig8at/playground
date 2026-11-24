Sos el paso de TRIAJE de una revisión de knowledge (la biblioteca técnica local de CreditOp) contra main.

Leé ENTERO `{paquete}` (con Read, en tramos). Cada «ÍTEM» es una sección de prosa vigente (o el objetivo de un área sin sección) y los archivos que cambiaron en main desde que se verificó. Al final, en «ARCHIVOS», el CAMBIO NETO de cada archivo: el diff desde el commit con que se escribió la sección hasta main. Si varios PRs lo tocaron, el diff ya trae sólo el resultado final: es lo único que importa.

Para CADA ítem, comparando lo que AFIRMA la prosa con lo que el diff cambia:
- `no_toca`: el diff cambia cosas que la prosa no afirma (otro método, otro caso, nombres, formato, tests, logs). Exigí poder decir QUÉ afirma la prosa y por qué ese diff no lo toca.
- `contradice`: el diff cambia, agrega o quita algo que la prosa afirma o que debería decir (una condición, un valor, una ruta, una tabla, quién decide, un método renombrado o borrado).
- `no_se_sabe`: el diff es un CAMBIO GRANDE (recortado) y lo que la prosa afirma podría estar en la parte que no se ve, o el diff solo no alcanza para saber si la afirmación sigue en pie (depende de otro archivo). Ante la duda, `no_se_sabe`: el paso de código lee el archivo entero en main, y es más barato que re-sellar algo falso.
Un archivo marcado «YA NO ESTÁ EN MAIN» es siempre `no_se_sabe` como mínimo.

Escribí `{salida}`: una lista JSON, un objeto por ítem, `{"id": "<id tal cual>", "veredicto": "no_toca|contradice|no_se_sabe", "por_que": "<1-2 frases: qué afirma la prosa y qué hace el diff>", "mirar": "<si no es no_toca: qué comprobar en el código>"}`. TODOS los ítems; validá que parsea. No escribas nada más.
