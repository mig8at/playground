Sos el paso de TRIAJE de una revisión de canon (el corpus de conocimiento de CreditOp) contra main. NO leas código ni diffs: sólo el paquete.

Leé ENTERO `{paquete}` (con Read, en tramos). Cada «ÍTEM» es una sección de prosa vigente (o el objetivo de un área sin sección), los archivos que cambiaron en main desde que se verificó (con su `--shortstat`) y los PRs que los cambiaron. Al final, cada PR con su título y descripción.

Para CADA ítem, comparando lo que AFIRMA la prosa con lo que los PRs dicen que cambiaron:
- `no_toca`: los PRs cambian cosas que la prosa no afirma. Exigí poder decir QUÉ afirma la prosa y por qué el PR no lo toca.
- `contradice`: algún PR cambia, agrega o quita algo que la prosa afirma o que debería decir.
- `no_se_sabe`: descripción vacía, plantilla o demasiado general, o un cambio grande donde podrían estar los detalles que la prosa afirma. Ante la duda, `no_se_sabe`: mirar el código es más barato que re-sellar algo falso.
Un archivo marcado «YA NO ESTÁ EN MAIN» es siempre `no_se_sabe` como mínimo.

Escribí `{salida}`: una lista JSON, un objeto por ítem, `{"id": "<id tal cual>", "veredicto": "no_toca|contradice|no_se_sabe", "prs": ["repo#n"], "por_que": "<1-2 frases>", "mirar": "<si no es no_toca: qué comprobar en el código>"}`. TODOS los ítems; validá que parsea. No escribas nada más. Devolvé el conteo por veredicto y los 3 `contradice` más importantes.
