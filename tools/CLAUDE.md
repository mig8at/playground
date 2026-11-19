# tools — cómo se complementan las herramientas de my-tools

Lo que sigue vale para DISEÑAR o CAMBIAR una herramienta (harness, tablero, visor, los conectores), no para usarla: cuál usar para cada pregunta está en el `CLAUDE.md` raíz. Vivió ahí hasta
el 2026-09-27.

## Cinco formas en que se complementan, las cinco medidas

La tabla del `CLAUDE.md` raíz dice cuál usar. Esto dice algo que no estaba escrito en ningún lado: **estas
herramientas se validan y se prestan cosas entre ellas**, y casi todo lo que sigue salió de una sola
sesión (2026-09-18) en la que nadie fue a buscarlo. *(Varios ejemplos son del trazador personal, retirado el
2026-10-13: las lecciones siguen valiendo, sus comandos ya no existen.)*

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

## Qué se puede correr en paralelo (medido el 2026-11-18)

Varias sesiones de Claude (o una con subagentes) usan las herramientas a la vez. Esto es lo que se MIDIÓ lanzando los
comandos en el mismo instante; lo que no se midió lo dice. Las escrituras se probaron sobre una copia (`TABLERO_DATA`).

| qué | a la vez | lo que pasa |
|---|---|---|
| leer: `bin/pg` (tareas, sql, logs…), `bin/sentinel`, `bin/correo`, `bin/chat inbox\|history`, `bin/cockpit status\|doctor` | ✅ ×3–4 | cada una contesta lo suyo; `bin/pg` recompilándose en cuatro a la vez, también |
| `bin/cockpit ensure <app>` | ✅ ×3 | levanta UN solo servidor |
| `make ui-shot` | ✅ ×3 (dos de la misma app) | cada una su Chromium. Dos de la misma app en el mismo segundo comparten nombre de archivo: pasá `OUT=` |
| `bin/wally ask` en conversaciones o agentes DISTINTOS | ✅ | independientes |
| `bin/wally ask` en la MISMA conversación | ⛔ de a una | la segunda sale 1 al instante («ya hay una pregunta en curso», 409); antes se mezclaban los bloques |
| `bin/jarvis` en pestañas distintas (`tabs new`, y cada comando con `--session N`) | ✅ ×3, 15 de 15 | cada comando lee SU página. Sin `--session` cae en la última pestaña abierta, que puede ser de otra sesión |
| `make task-block` (o `BLOCK=`) a la misma tarea | ✅ ×6 | los seis bloques quedan, enteros |
| `make worklog-add` | ✅ ×6 | van en fila (candado en `data/entries/.lock`); un lapso que se pisa con el de otra sesión sale 2 |
| `git commit -m … -- <rutas>` | ⚠ de a uno | git toma `index.lock`: el segundo FALLA con «Another git process…» y no pierde nada. Se reintenta. 5 de 20 entraron al primer intento |
| dos tandas del harness | ⛔ (no medido acá) | comparten identidad: lo que va junto va en UNA tanda con `PARALLEL=1` (`harness/CLAUDE.md`) |
| Knowledge y una sesión editando el mismo tema de `knowledge/` | ⚠ (no medido) | Knowledge corre de a una y commitea por ruta; si una sesión tiene ese archivo a medio editar, su paso de aplicar puede chocar |
| servidores (`make tablero`, `make panel`…) | ⛔ uno por app | el segundo choca por el puerto: `bin/cockpit status` antes, o `bin/cockpit ensure` |

Tres cosas que salieron de medir, y por qué importan al tocar una herramienta:

- **Un archivo que se reescribe entero necesita candado entre procesos.** La bitácora lee el mes, agrega y reescribe:
  con cinco a la vez quedó UNA entrada, y una de las perdidas había dicho «ok». Agregar una línea (`O_APPEND`, como la
  pila de una tarea) no lo necesita.
- **Lo que se reenvía entre dos conexiones tiene que conservar el orden.** El puente de Jarvis mandaba los eventos de
  Chrome en orden y las respuestas por una goroutine aparte; con dos sesiones arrancando, un evento le ganaba a su
  respuesta y la sesión quedaba colgada 60 s (`jarvis/CLAUDE.md`, trampas). Con una sola sesión no se veía nunca.
- **Un recurso de a uno contesta «ocupado» enseguida**, con código distinto de cero, en vez de encolar en silencio o
  mezclar: el que llama decide si espera.

## El idioma del código (la regla entera; el resumen está en el `CLAUDE.md` raíz)

Decisión de Miguel (2026-11-18), para todas las herramientas de my-tools:

- **En inglés, todo lo que es código:** carpetas, archivos, identificadores (variables, funciones, tipos, constantes),
  claves JSON, clases CSS y tokens, rutas de API, comandos y opciones de un CLI (y lo que imprime), targets y
  variables de `make`, los verbos de un protocolo (lo que un agente de Wally escribe para pedir algo) y los valores
  internos (estados, tipos).
- **En español, lo que ve una persona en una interfaz:** el texto del HTML y de las plantillas Vue, los avisos y
  los mensajes de la pantalla. También la documentación (`CLAUDE.md`, `knowledge/`, las tareas) y los
  comentarios del código.
- **Se quedan los nombres propios** de las herramientas (`tablero`, `cuadrilla`, `harness`, `wally`, `jarvis`,
  `correo`, `sentinel`…) y los datos (los valores que vienen de la base o de un servicio).
- **Excepción decidida (2026-11-18): las claves de los contratos del harness** —las suites (`casos`, `comercio`,
  `espera`…), el mapa del panel (`panel/steps.json`), las fichas de `merchant-specs/`, `harness.case/v1`,
  `harness.doctor/v1` y el registro de fallas— siguen en español. Son miles de usos en 149 archivos y la
  herramienta con la que se valida; un renombre a medias no falla, devuelve vacío. Se pasan a inglés, con alias
  para las viejas, la parte que se toque por otra razón, y se prueba ahí. Lo nuevo va en inglés.
- **Claude contesta en español** cuando se habla de my-tools y sus herramientas.
- **La vara es `make tablero-naming`:** falla con un nombre nuevo en español. Lo de antes queda en
  `tablero/tools/naming-debt.txt` como deuda, y se baja renombrando con `tablero/tools/rename/`. Al renombrar un
  comando o un target, el nombre viejo sigue como alias, porque las tareas guardan el comando exacto de cada
  medición.

## La ayuda de un CLI no arranca nada (2026-11-19)

Un agente que no conoce un comando prueba `help`, `--help` o el comando pelado. Para todos los `bin/*`:

- **`help`, `-h`, `--help` y el comando sin argumentos** muestran la ayuda por stdout y salen con 0. No levantan un
  servidor, no abren Chrome, no pasan por Cockpit ni tocan la red.
- **Un comando que no existe** dice cuál fue en una línea (`no conozco «X»`, con el parecido si lo hay), por stderr, y
  sale con 2. Tampoco arranca nada: se revisa ANTES de asegurar que la app esté arriba.
- **Faltó un argumento** de un comando que sí existe: el uso por stderr y 2.
- Los que además son un servidor (`sentinel`, `correo`) sólo sirven con sus flags (`-serve`, `-once`, `-install`…):
  el binario sin argumentos sigue siendo el servidor (así lo corre el LaunchAgent), pero el envoltorio `bin/` muestra
  la ayuda. Los flags del servidor: `bin/sentinel --flags`.
- Los que leen texto por stdin (`aistudio`, `chatgpt`, `deepseek`, `groq`, `kimi`) no muestran la ayuda sin
  argumentos cuando les llega algo por stdin: eso es una pregunta.

Antes (medido ese día): `bin/sentinel help` y `bin/correo` levantaban la API y no volvían; `bin/jarvis --help` y
`bin/wally help` esperaban a que Cockpit arrancara la app; `models`, `point` y `jarvis help` salían con 2.
