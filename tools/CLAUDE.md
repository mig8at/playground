# tools — cómo se complementan las herramientas del playground

Lo que sigue vale para DISEÑAR o CAMBIAR una herramienta (harness, trazador, tablero, visor, los
conectores), no para usarla: cuál usar para cada pregunta está en el `CLAUDE.md` raíz. Vivió ahí hasta
el 2026-09-27.

## Cinco formas en que se complementan, las cinco medidas

La tabla del `CLAUDE.md` raíz dice cuál usar. Esto dice algo que no estaba escrito en ningún lado: **estas
herramientas se validan y se prestan cosas entre ellas**, y casi todo lo que sigue salió de una sola
sesión (2026-09-18) en la que nadie fue a buscarlo.

**1 · UNA LE PRESTA UN PATRÓN A OTRA.** Cuando una herramienta resolvió bien un problema, la otra lo
copia en vez de inventar. `bin/steps-check.ts` del harness —valida el mapa **sin insumos** y sale ≠0—
se copió al trazador como `make trazador-chequeo`, y con él llegó el criterio de qué testear que usan
las specs de `pkg/`: **no cobertura, sino la lógica que ya dio un diagnóstico equivocado**. En el otro
sentido, el `MD=1` del trazador se copió al arnés. Antes de diseñar algo, mirá si la de al lado ya lo
tiene resuelto.

**2 · UNA ES LA VARA DE OTRA.** Lo que una declara se contrasta contra lo que otra **deriva del
código**, no contra una copia nuestra. Es lo que hace `npm run contrato:bancolombia` (el mock contra
los zod reales), y lo que ahora hacen dos cruces más: `trazador/logs.json` —el índice de los mensajes
que el código emite— valida los matchers del mapa del trazador, y encontró **cinco mudos** por una
renumeración; y el emisor de anotaciones del arnés se prueba leyendo el **regex real** con que el tablero
las reconoce (`reAnnotation`, en su `store`). ⚠ La regla es la de los mocks: **una herramienta no puede
contradecir el documento del que nació**, así que la vara tiene que venir de otro lado.

**3 · DOS COMPARTEN VOCABULARIO, Y ESO HAY QUE COMPROBARLO.** `trazador/server/mapa/ramales.json` dice
que sus ids de ramal son los mismos que los de `harness/panel/steps.json` *«a propósito: dos
vocabularios para lo mismo es como empiezan a derivar»*. Era un comentario, o sea una afirmación que
nadie verificaba — exactamente la deriva que decía estar evitando. Hoy `trazador-chequeo` la comprueba
y ya encontró una divergencia (`credifamilia` es *ramal* en una y *extensión* en la otra).

**4 · UNA ROTA ENVENENA A TODAS, Y EL SÍNTOMA APARECE LEJOS.** El caso más caro del día: `roots.py`
resolvía el código contra el `main` LOCAL de cada clon, que nadie actualiza — cinco de diez repos
estaban detrás, hasta 22 commits. De esa **única causa** salían cinco mentiras en cinco herramientas
distintas:

    oracle.py     DROP sobre rutas que sí existen en main  → manda a borrar una cita buena
    refs.py       «corrida ≤3 líneas» sobre una cita a 52  → da por sana deriva real
    alinear.py    `microservicios` sano con 67 % de deriva → esconde el nodo que hay que releer
    logs.json     400 mensajes de menos                    → el trazador no resuelve mensaje→archivo
    quemado       391 hardcodes en vez de 409              → subestima la deuda

⚠ **Ninguna falló.** Todas devolvieron menos, y «menos» se lee igual que «no existe». Cuando una
herramienta te dé un resultado tranquilizador, preguntá de qué está leyendo antes que si está rota.

**5 · UNA ENRUTA HACIA OTRA.** La deriva se mide por **archivos tocados**, y un archivo puede estar en
un nodo por UNA razón y cambiar por otra. `db-routines` lista `MareiguaService.php` porque invoca una
rutina; su cambio de septiembre no tocó ninguna rutina —verificado: ni un `CALL`, `SP_` o `FN_` en el
diff— sino la cascada de identidad, o sea `kyc`. Seguir ese enrutamiento fue lo que destapó que el
«Antes de concluir» de `kyc` afirmaba algo **falso desde diez días antes de que el nodo se sellara**.

⚠ **Y la lección que atraviesa las cinco: lo que una herramienta AFIRMA sobre otra hay que cablearlo,
no escribirlo.** Los comentarios «esto coincide con aquello» envejecen sin avisar; los chequeos, no.
