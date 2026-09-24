# tablero — protocolo (las TAREAS a realizar)

Qué es y cómo se corre: `README.md`. Acá solo las reglas al trabajar con las tareas.

## Dónde está cada cosa en pantalla

El tablero es un **workbench** (ver el `CLAUDE.md` raíz, §«Y cómo se DIVIDE la pantalla»), no una
página que scrollea:

| Región | Qué tiene |
|---|---|
| `sidebar` | su título (`Mis tareas`, el conteo, **⊟** y **⋯**), el buscador, y debajo **un acordeón con una vista por estado** — *En curso · Bloqueadas · En pruebas · Por empezar · Terminadas* — más *Traer de Jira* al final. Cada fila Jira lleva al borde el icono para **avanzar al paso siguiente**. Arranca abierta sólo **En curso**; las demás cuestan una fila y muestran su conteo igual. El **⋯** lleva los filtros (con tilde y conteo), «locales», «ver todas» y el ancho del sprint |
| `editor` | **una barra con las tareas abiertas** (como los archivos en VS Code) y debajo, de la enfocada, una cabecera con estado, sprint, puntos y Jira, seguida por la cronología curada de `task-context/`: **Hoy**, **Ayer** y las fechas reales anteriores, cada una un encabezado que se pega arriba mientras se lee y se pliega con un clic. Después queda el documento como consulta. Sin ninguna abierta manda **la vista abierta del acordeón** izquierdo: el sprint (los 4 indicadores + Mi jornada) o el import de Jira |
| `panel` | la consola de ramas de la tarea enfocada: tabla del repo elegido y selector a la derecha con **sólo los repos trabajados en esa tarea**. Está abierta por defecto y **Ramas** queda visible en el pie cuando se cierra. Lee `data/cache/ramas.json`, no corre Git al renderizar y se puede redimensionar; sin ramas se reduce a una franja informativa |
| `statusbar` | sprint, cuánto le queda y cuántas tareas hay a la vista |
| `auxiliarybar` | un riel horizontal de **pestañas** con *Jira · Pendientes* y, cuando existen, *Artifacts*. Una sola ocupa todo el cuerpo; Jira abre primero y muestra el issue completo sin marco de tarjeta. No repite una ficha de Detalle. Sólo aparece con una tarea abierta; el control del pie lo apaga y lo recupera |

En ventanas de hasta 1050 px las vistas derechas arrancan plegadas para conservar el ancho de lectura.
El control del pie lo abre de forma temporal; esa decisión no cambia la preferencia de las ventanas
grandes.

⚠ **La gramática visual es una sola en todas las regiones.** Filas y repos activos usan una
superficie suave con radio corto; las dos barras de pestañas comparten el mismo estado seleccionado;
los controles de disposición forman un grupo compacto. Los bordes separan regiones y filas de datos,
pero no envuelven otra vez cada elemento. Un conteo se muestra una sola vez junto a su nombre.

⚠ **No hay titlebar, a propósito.** Decía «Tablero · Sprint N · registro de tiempo y hallazgos» y
gastaba 77px de alto en repetir lo que ya dicen la pestaña del navegador y el statusbar. Su única
acción —«sólo este sprint»— vive en el **⋯** del sidebar, que es donde van las cosas que se alternan y
se tocan poco.

⚠ **Avanzar de estado vive en la fila de la tarea.** El icono consulta las transiciones permitidas por
Jira y ofrece sólo el paso siguiente del flujo normal, no bloqueos, invalidaciones ni retrocesos. El
clic derecho conserva el mismo acceso como atajo de teclado/ratón; una tarea terminada no muestra el
icono porque no tiene un avance normal.

⚠ **A la derecha hay pestañas y a la izquierda un acordeón**, porque responden a usos distintos: a la
izquierda las vistas son cinco ESTADOS de una lista y querés ver varios a la vez; a la derecha son
caras de UNA tarea, que se leen de a una. El riel conserva siempre los conteos y deja todo el alto
para Jira, Pendientes, Artifacts o la vista activa, sin apilar seis encabezados.

⚠ **El editor usa la cabecera para los datos breves y el cuerpo para el trabajo de la tarea.** Ahí se
apilan los avances por fecha, las decisiones, las referencias y el documento histórico. Las vistas de
consulta que requieren acción viven al costado; las ramas abajo, donde la tabla puede cruzar el editor
y el sidebar derecho sin convertirse en otra pestaña lateral.

⚠ **Los dos sidebars se arrastran, y el tope NO es un número fijo**: se calcula contra la ventana y el
ancho de la otra columna para que el editor nunca baje de 320px. Medido — con las vistas en 463 sobre
una ventana de 927 el editor quedaba en 164, o sea el documento en veinte caracteres de ancho. Los
anchos se guardan y se vuelven a acotar al abrir, porque la ventana pudo achicarse desde la última vez.

⚠ **No hay una ficha duplicada al costado.** Sprint, puntos, tiempo, Jira y contexto local viven bajo
el título y siguen visibles mientras cambia la vista auxiliar. **El editor de la tarea no tiene botón
de cerrar**: lo tiene su pestaña, que es donde uno lo busca; `Esc` hace lo mismo.

⚠ **Se abren VARIAS tareas a la vez, y la pieza que hace que eso sirva es la pestaña en PREVISTA.**
Un clic en el árbol abre la tarea en previsualización —en itálica— y el siguiente clic **la reemplaza**
en vez de sumar otra: recorrer 35 tareas deja UNA pestaña, no 35. Se fija con doble clic en la fila o
con un clic en su propia pestaña. Cerrar la activa enfoca la vecina, no vuelve al sprint; cerrar todas
sí. Si algún día se saca el modo previsualización «para simplificar», en diez minutos hay veinte
pestañas y ninguna se encuentra — es la mitad del patrón, no un adorno.

⚠ **Los cinco estados se nombran en UN solo lugar**: `TASK_GROUPS`, en `ui-state.js`. `FILTROS` sólo
declara el ORDEN, que es distinto a propósito — el filtro se lee como un flujo (sin empezar →
terminada) y el acordeón por atención (lo que está en vuelo primero). Tenían dos juegos de etiquetas
para los mismos ids y no molestaba mientras vivían lejos; desde que el menú ⋯ y las vistas comparten
una columna de 300px, el menú decía «iniciada 2» pegado a una vista que decía «En curso 2».

⚠ **Esto era otra cosa hasta el 2026-09-18**, por si encontrás una captura vieja o un comentario que
no coincide: las tareas eran una GRILLA DE TARJETAS y al elegir una se abría un CAJÓN encima de la
página. Hoy no hay tarjetas ni cajón — hay filas en un árbol y un editor. El texto de acá abajo ya
está al día; lo que puede no estarlo es un `.md` de tarea escrito antes.

⚠ **El contador del encabezado es la única señal de que hay un filtro puesto**, ahora que las
casillas viven en el `⋯`. Pasa de `9` a `9 / 16` y se pone ámbar. Si algún día se agrega un filtro que
el contador no refleje, ese filtro **no puede ir al menú**: tiene que quedar a la vista.

⚠ **Y al entrar NO hay ninguna tarea seleccionada, a propósito.** Antes sí —quedaba la que estaba en
curso— porque `active` sólo decía «sobre cuál se registra el tiempo». Ahora `active` es **lo que
muestra el editor**, así que autoseleccionar significaba entrar directo a una tarea y no ver nunca el
sprint.

## Plantilla por vista

El editor central muestra una única historia por fecha: **Hoy**, **Ayer** y luego la fecha real de
cada jornada anterior. Sólo contiene los bloques de la pila —título y descripción—; no se muestran
minutos ni notas de sesión. El documento queda después de la cronología como consulta, y **aparece
sólo si tiene contenido**: una tarea limpia está vacía (pedido de Miguel, 2026-09-23). Un contenedor
vacío con su «todavía no hay» pide que lo llenen con algo que la tarea quizá no hace. Y no se describe
a sí mismo: el documento no lleva rótulo, lo nombran sus secciones. El sidebar derecho queda para lo
accionable: **Jira · Pendientes · Artifacts** cuando la tarea tenga artefactos.

*(Hasta el 2026-09-23, después del documento venían «Hallazgos y decisiones» y «Evidencia de trabajo»,
que salían de las anotaciones fechadas del documento. Ese día las anotaciones pasaron a la pila y las
dos vistas se fueron con ellas: hoy cada hecho es un bloque de la cronología.)*

Cada dato tiene una fuente. Al crear una tarea, copiá `TASK-TEMPLATE.md`; al retomar una abierta,
actualizá sus secciones existentes. No agregues una segunda lista ni otro estado de la misma cosa.

| Región | Pregunta que responde | Fuente |
|---|---|---|
| Hoy, Ayer o fecha | ¿Qué se fue documentando de la tarea? | Bloques de `tasks/<slug>/context.jsonl` |
| Documento de trabajo | ¿Cuál es el plan y el material vigente? | Cuerpo privado de `tasks/<slug>/task.md` |
| Jira | ¿Qué ve el equipo en el issue? | Estado y descripción recibidos de Jira |
| Pendientes | ¿Qué falta completar? | Casillas del cuerpo privado, agrupadas en `## Pendientes` para tareas nuevas |
| Artifacts | ¿Qué salida navegable deja la tarea? | Lo que haya en `tasks/<slug>/artifacts/` |

### Trabajo

Lo que se hizo, lo que se midió o se decidió y dónde quedó la tarea vive en la **pila de bloques**, no
en el documento. El documento lleva lo que sigue siendo cierto: objetivo, dónde se toca, plan,
alternativas descartadas, límites, material de validación y referencias, en el orden de la plantilla.
Los pendientes no se repiten: viven en su vista lateral.

⚠ **Desde el 2026-09-23 el documento no lleva historia**: ni `## Registro`, ni anotaciones fechadas
(`> **MEDICIÓN · fecha** — …`), ni la sección de retoma («Si retomás esto sin contexto»), ni marcadores
`> **CANON · …**`. Ese día las 22 tareas abiertas que los tenían pasaron a la pila —**430 bloques**,
`via: migration`, cada uno con su fecha real; #94 y #95 más tarde, cuando terminó la sesión que las
editaba— y el lint de las tareas frena uno nuevo en el documento y dice adónde va. Uno que ya estaba sólo
avisa: hoy lo tiene nada más la «Bitácora» de #67, archivada, que no se migra porque las tareas ya
publicadas no se migran (Miguel, 2026-08-20). La retoma se fue sin su «próximo paso», como los `next` de
los hitos del paso 2: uno fijo obliga a hacer algo después, y eso es decisión de cómo se va desarrollando
la tarea (Miguel, 2026-09-23).

### Avances

Cada avance es un bloque de trabajo con fecha, tiempo y una nota en forma **acción realizada →
resultado → validación**. Se guarda de forma append-only en `data/entries/`; una entrada vieja no se
edita ni se reclasifica. Sirve para la métrica de trabajo, no para la lectura de una tarea: la
cronología central usa únicamente `task-context/`.

El comando histórico conserva el nombre `make bitacora-add TAREA=<id>` por compatibilidad. No crea una
sección Markdown nueva: lo que pasó ese día va a la pila, como bloque.

### Bloques de la pila

`tasks/<slug>/context.jsonl` es la pila de la tarea: **bloques de documentación que entran con el
tiempo**, privados y versionables. Desde el 2026-09-23 no hay más estructura fija que el bloque mismo
(diseño acordado con Miguel; decisiones y plan en la tarea #84, «Frente: la pila de bloques»).

Un bloque muestra dos cosas: un **título** —una línea, la conclusión y no la actividad: «la regla sí
excluye», no «revisé la regla»— y una **descripción** en prosa libre, que adentro nombra lo que la
sostiene con enlaces con tipo y comandos con su resultado:

| Qué se nombra | Cómo se escribe | Qué comprueba el validador |
|---|---|---|
| un tema de canon | `[texto](canon:tema#ancla)` | que canon lo conozca (sin red, entra con un aviso) |
| un archivo | `[texto](repo:<repo>/<ruta>#L12)`, nunca una ruta local | que el repo se pueda citar y la ruta exista; **lo fija al commit** |
| un PR · un issue | `[#1140](pr:legacy-backend#1140)` · `[CORE-431](jira:CORE-431)` | que el repo se pueda citar |
| otro bloque | `[el de ayer](bloque:<id>)`: así se corrige uno sin editarlo | que esté en la pila |
| una página | `[texto](https://…)` | nada |
| una prueba | bloque ` ```harness ` o ` ```trazador ` con el comando, y debajo `Resultado: …` | que el comando diga su `TARGET=` |
| una consulta | bloque ` ```sql prod ` con el `SELECT`, y debajo `Resultado: …` | ambiente presente y sólo lectura |
| otro comando | bloque ` ```sh `, y debajo `Resultado: …` | que lleve su resultado |

El material que no es un comando —un JSON de ejemplo, un texto— va en ` ```json ` o ` ```text `. El título
puede llevar `código` entre comillas invertidas; enlaces, no.

**Lo que antes era una anotación es un bloque.** Una medición, una decisión o un riesgo son un hecho
con fecha: el título dice el hecho —«la 199 quedó con product credit y sólo CC»— y la descripción lo que
lo sostiene; si ayuda, arranca nombrando qué es («**Decisión.** …»), que es como quedaron las 119
anotaciones migradas. Una **pregunta a alguien** es además un pendiente con su `Depende de:` —así se
cierra tildándolo, y `make hoy` la muestra como «espera a …»—; el bloque cuenta que se preguntó.

Internos, en el JSON y **nunca en pantalla**: `id`, `at` —la fecha, que sólo agrupa los bloques en el
acordeón Hoy · Ayer · fechas— y `via`, quién lo agregó (`manual`, `harness`, `trazador`, `db`, y
`migration` para lo que se convirtió de un formato anterior). **No hay «siguiente paso»**: obliga a hacer
algo después, y eso es decisión de cómo se va desarrollando la tarea; si se decide uno, entra como un
bloque más o como un pendiente.

Se escribe en un Markdown —`# título` en la primera línea y la descripción debajo— y se agrega con
`make tarea-bloque N=<id|slug> ARCHIVO=<bloque.md>` (`SECO=1` previsualiza sin escribir; `ARCHIVO=-` lo
lee de stdin). **Las herramientas de evidencia lo hacen solas con `BLOQUE=<id|slug>`**: `harness-caso` ·
`-listado` · `-caminar` · `-suite`, `trazador-ureq` · `-buscar` · `-sql` y `tablero-db`, cada una con su
`via`. El ejemplo
validable es `docs/task-context-block.example.md`; el contrato de la línea guardada,
`docs/task-context.schema.json`. Se lee con `make tarea-context N=<id|slug>` o `make retomar`.

⚠ **Lo que rechaza, y por qué.** Una ruta local o un archivo sin su repo: no se abre desde otra máquina.
Una ruta que no existe: una cita rota la lee un modelo y abre otra cosa. Un comando sin `TARGET=`: el
harness y el trazador tienen defaults OPUESTOS (F-234). Un comando sin `Resultado:`: sin lo que dio no
prueba nada. SQL que escribe o sin ambiente, HTML, y un título de más de una línea. Los repos que se
pueden citar salen de `tools/repos.json` —la lista única, no una copia, que resuelve `connectors/repos`—,
más `playground` (este repo) y `playground-equipo` (el compartido).

⚠ **Hasta el 2026-09-23 la pila era de HITOS** (`kind` checkpoint · decision · blocker · evidence, con
`summary`, `state` y `next`). Los 37 que había se migraron ese día a bloques con `via: migration`: el
título se escribió a mano, la descripción conserva objetivo, resumen, estado, motivo y espera en el
orden en que se mostraban, y el «siguiente» se fue. El formato ya no se lee —una línea vieja hace fallar
la lectura— y `make tarea-context-add` sólo avisa del camino nuevo.

⚠ **Y ese mismo día entró la historia del documento.** Las anotaciones, el `## Registro` y la sección de
retoma de las 22 tareas abiertas que los tenían se convirtieron en **430 bloques** (`via: migration`): una
anotación con su fecha; el Registro partido por su fecha real —cada `### día`, cada viñeta
`- **fecha** —` y cada `####` de adentro, con su subtítulo como título—; la retoma con la fecha en que se
escribió por última vez, sin su «próximo paso». Los títulos largos se escribieron a mano; los archivos
citados quedaron fijados al último commit anterior al día del bloque; el código que no era un comando
con su resultado quedó como material; los párrafos que sólo contaban un barrido de rutas se descartaron,
y en #84 los que repetían un bloque que ya estaba. El frontmatter y la sección publicable no se tocaron
(comprobado byte a byte). De las 20 archivadas, sólo #67 conserva una «Bitácora», y se queda así.

### Jira

Esta pestaña abre primero y usa todo el alto del sidebar para mostrar lo recibido de Jira al cargar el
sprint; no es una vista previa del borrador ni una tarjeta dentro de otra tarjeta. Una franja compacta
conserva el estado y el enlace al issue. Si no hay issue o descripción, se indica esa ausencia. El
borrador local conserva la frontera exacta
`## Tarea (publicable)` y usa las secciones de `TASK-TEMPLATE.md`: **En una línea · Por qué · Qué
cambia · Alcance · Dónde probar · Cómo validar · Cambios en datos · Criterios de aceptación ·
Dependencias / contraparte**. Producto y QA deben poder entenderlo sin las herramientas privadas.
Editar el archivo no publica nada: la revisión y autorización para publicar siguen siendo necesarias.
Los proyectos (`clase: proyecto`) no llevan sección publicable.

### Pendientes

Una lista canónica bajo `## Pendientes`. Cada casilla empieza con una acción y dice cómo se sabe que
terminó; una dependencia agrega de quién se espera qué. El detalle puede continuar debajo de la
casilla. Ejemplo de formato, para reemplazar por datos reales:

```markdown
- [ ] Validar el flujo en staging; termina cuando el caso acordado pasa y queda evidencia.
  Depende de: nombre — dato o respuesta necesaria.
- [x] Acción completada — comprobación o enlace a la evidencia.
```

No copies estas casillas en el documento ni en la pila: la lista guarda lo abierto.
Marcá completado sólo lo verificado. Los criterios públicos para QA pertenecen a Jira.

### Hallazgos

⚠ **No confundir con las TRAMPAS del sistema (`F-xx`), que también viven acá desde el 2026-09-21**
(`data/traps/doc.md`, `make trampas`). Un hallazgo es un bloque DENTRO de la pila de una tarea y muere
con ella; una trampa es del sistema, no pertenece a ninguna tarea, y se entra por su SÍNTOMA.
Vinieron del árbol de contexto que se apagó porque son **crónica** —síntoma, causa raíz, evidencia, arreglo— y
la crónica no entra en canon; su lector real ya era este tablero. Dos cosas con nombre parecido es
como empiezan a mezclarse, así que: lo que le pasó a ESTA tarea es un hallazgo; lo que le pasa al
sistema y ya nos costó tiempo es una trampa.

Un hallazgo —una medición, una decisión, una pregunta, un riesgo— es **un bloque de la pila**: el
hecho en el título y lo que lo sostiene, con su comando y su `Resultado:`, en la descripción (ver
«Bloques de la pila»). Una pregunta que espera a alguien es además un pendiente con `Depende de:`.
*(Hasta el 2026-09-23 era una anotación en el documento, `> **TIPO · YYYY-MM-DD** — hecho`, y la vista
«Hallazgos» las reunía; las anotaciones pasaron a la pila ese día y la vista se fue con ellas. El
marcador sigue siendo el formato de los documentos que NO son una tarea —un `CLAUDE.md`, una trampa—,
que es lo que imprime `MD=1` en el arnés, el trazador y `tablero-db`.)*

### Consola de ramas

Declaración mínima: `ramas: patron-de-la-rama` en el frontmatter, sólo cuando exista; varios patrones
se separan por coma. Actualizá la medición con `make tareas-ramas N=<id>` desde la raíz del playground.
Repositorio, rama, PR, ambientes y fecha de medición vienen del snapshot. No mantengas una segunda
tabla de estados en Markdown ni presentes una medición antigua como una comprobación de hoy. Si el
trabajo no tiene rama propia, no inventes un patrón para llenar la consola.

Los siete contenedores locales no declaran una lista histórica de ramas: agrupan mejoras sucesivas y
una rama vieja deja de representar su estado. Si una mejora activa necesita seguimiento de entrega,
se anota dentro de su frente mientras exista; una tarea de producto en `work` sí mantiene `ramas:`.

La consola inferior agrupa la medición de la tarea enfocada: la tabla ocupa el área principal y el
selector derecho contiene únicamente los repos que aparecen en sus ramas. Al cambiar de tarea cambia
la consola. Si no existe `ramas:` o todavía no se midió, muestra un estado vacío; nunca rellena el
hueco con todos los repos del workspace. **Ramas no aparece entre las pestañas derechas.** Las columnas
Rama y PR permanecen fijas al desplazar ambientes, la cabecera explica los tres estados y la fecha se
lee de forma relativa con el instante exacto al pasar el cursor.

Cada tarea tiene una ruta copiable: `#/tareas/context` para los contenedores locales y
`#/tareas/core-543` para Jira. La ruta abre las locales aunque el filtro «locales» estuviera apagado,
se restaura al recargar y participa de atrás/adelante. Se usa hash routing para no depender de un
fallback del servidor estático.

La recarga sigue el patrón **cache-first + stale-while-revalidate**: `tablero:bootstrap:v1` conserva
durante siete días el último sprint, sus tareas y la ventana de cuatro sprints. Se pinta y restaura la
ruta en el primer frame; después Jira se consulta por `fetch` en paralelo y reemplaza la caché. Un
estado viejo nunca se presenta como sincronizado: el pie dice `actualizando Jira…` o `Jira sin
actualizar`. Efforts, capas locales, pulso y ramas también se piden en paralelo y no bloquean Jira.
La caché del navegador es sólo de arranque; las fuentes siguen siendo Jira y los archivos locales.

### Avances por tiempo

Una entrada por tramo de trabajo, ligada a la tarea y con tiempo medido. La nota sigue la forma
**acción realizada → resultado → validación**; los detalles reproducibles quedan en Trabajo.
Se registra con `make bitacora-add TAREA=<id>` y una fuente de tiempo (`LAPSO`, `PULSO` o `MIN` con
`FUENTE`), según la regla de cierre de sesión de abajo. No inventes minutos ni copies aquí el diario
completo. La pila cuenta qué pasó; los avances contabilizan el tiempo. No crees `## Bitácora` ni
`## Registro` en el Markdown de una tarea.

**Artifacts** aparece a la derecha cuando existen artefactos; sigue la convención de
`tasks/<slug>/artifacts/` descrita abajo. No crea otra fuente ni mezcla esos archivos con el relato central.

## De dónde sale lo que se escribe acá

El tablero es el DÓNDE; el conocimiento y la evidencia los producen otras herramientas, y cada
una tiene un lugar propio en el archivo de la tarea. Esta tabla es el espejo de la sección «Qué deja
esto en la tarea» que cierra el `CLAUDE.md` de cada una:

| herramienta | contesta | deja en la tarea |
|---|---|---|
| **canon** (otro repo: `github/playground/tools/canon`) | lo que ya se sabe del sistema, COMPARTIDO con el equipo | `canon:` al abrir · una **graduación** al cerrar |
| el código de `main` (`git grep` contra la rama) | lo que nadie escribió | **«Dónde se toca»** — archivos con el porqué |
| [`harness/`](../harness/CLAUDE.md) | ¿funciona, corriéndolo? | **«Cómo se comprueba»** — el comando, no la conclusión |
| `tablero-db` | ¿qué dicen los datos en un ambiente? | referencia DB: ambiente + consulta SQL de sólo lectura |
| [`trazador/`](../trazador/CLAUDE.md) | ¿cómo se comportó una solicitud concreta? | la traza o la medición de esa solicitud, nunca una consulta SQL |

## Retomar una tarea: Claude Code + canon

Un agente que empieza el día no debería reconstruir el sistema desde cero ni confiar en un resumen
viejo. Primero corre `make tareas TODAS=1`, identifica la tarea o uno de los siete contenedores
locales, y corre `make retomar N=<id>`: la pila primero —el último bloque entero, con sus archivos
fijados a su commit— y lo que la tarea tenga en su documento. Con eso arma una hipótesis verificable.
Antes de editar, revisa `canon:` del frontmatter:

1. **Hay referencias declaradas:** `make retomar N=<id> BRIEF=1` trae al final la **ficha** de cada
   una —título, resumen y el `objetivo` de cada área con sus tablas y repos— desde `CANON_URL`.
   La ficha decide qué abrir; no reemplaza la lectura. Va hasta cuatro referencias; `BRIEF=a,b` elige
   cuáles. Preferí una cita exacta (`tema/context#ancla`) sobre un tema completo (`tema`).

   ⚠ **La ficha se deriva de la API, no se genera.** `GET /api/read` entrega los metadatos escritos
   en Canon; no llama a un modelo y no depende de una copia local del corpus. Si Canon no responde,
   la retoma muestra el error por referencia en lugar de inventar un resumen.

2. **No hay referencias, o el pedido llega demasiado general:** formula una pregunta técnica sin datos de
   caso y preguntale a canon — `go run . -pregunta '…'` desde su repo, o `/api/search?q=…`, que es
   gratis y devuelve la sección exacta con los archivos que la sostienen. Abre los candidatos,
   confirma cuál sirve, y sólo entonces agrega la referencia a `canon:`. Una sugerencia no se copia al
   frontmatter por sí sola.

3. **La pregunta es de una persona, una solicitud, una medición actual o un log real:** eso no lo
   contesta ningún corpus. Se usa el trazador o el arnés, y la evidencia se registra con su comando.

Cuando una referencia realmente cambie el curso de la tarea, se cita en el bloque que la usó, con
`[texto](canon:tema#ancla)`: el bloque dice qué se decidió o se hizo, y la cita, con qué se sostiene. Así
una referencia no queda marcada como leída por el solo hecho de estar en `canon:`. *(Hasta el
2026-09-23 esto era un marcador en el documento, `> **CANON · fecha · leído · validado** — …`; nadie lo
había usado nunca, y se fue con el resto de la historia del documento.)*

⚠ **Y la regla de corte, que es lo que mantiene al corpus como APOYO y no como oráculo: si la ficha
del tema no contesta, no se prueba otro tema — la pregunta va al código de `main`.** El silencio del corpus
es el modo de falla conocido (algo que existe en el código y nadie escribió), y una búsqueda no lo ve:
va a devolver el tema más parecido, con buena puntuación. Ahí es peor que leer el código.

### Cuando aparece una regla de negocio: canon, después `main`, y a canon

Trabajando una tarea aparecen reglas del negocio que la tarea no inventó: cómo se calcula un monto, qué
se le avisa a un comercio, quién queda afuera de un listado. **Cada una pasa por este recorrido, sin
que nadie lo pida** (Miguel, 2026-09-23):

1. **¿Canon la tiene?** `make canon-search Q='…'` con las palabras del negocio (es gratis) y, con el
   candidato, `make canon-read IDS=…`. Las recetas de lectura y de dictado, el formato de la pieza y
   sus trampas están en el skill **`canon`** (`.claude/skills/canon/SKILL.md`). Si la tiene y coincide, se cita en el bloque que la usó
   (`[texto](canon:tema#ancla)`) y se suma el tema a `canon:`. Si la tiene y **contradice** lo que dice
   el código, es una corrección: se reescribe la sección, no se agrega otra al lado.
2. **Si no la tiene, ¿es real y está viva?** Se verifica contra `origin/main` de **los dos monolitos**
   —`git show origin/main:<ruta>`, nunca el árbol de trabajo—: dónde se decide, desde cuándo
   (`git log -S`), y que se ejecute de verdad (que el código se alcance, no sólo que exista). Si se
   puede medir cuánto pasa, se mide en producción con el trazador.
3. **Si es viva, va a canon.** El filtro es el de `skills/dictar.md`: una regla que existe en `main`,
   incluidos sus errores, sin crónica y sin nada que dependa de un PR abierto. Lo que agregó ESTA
   tarea y todavía no se mergeó **no** entra: espera al merge. Se ensaya con `make canon-propose
   PIECE=…` y se dicta con `make canon-write PIECE=… TITLE=…` (borrador → piezas → cierre, en una
   revisión), con `objetivo`, `archivos` y `tablas`.
4. **Queda escrito en la tarea.** Un bloque dice qué regla era, con qué se verificó y en qué sección
   de canon quedó (su cita). Si canon de producción no responde —pide la VPN de prod—, la pieza queda
   lista en `artifacts/` de la tarea y un pendiente «Publicar en canon» con su condición de cierre;
   no se da por documentada hasta que aparezca en producción.

⚠ **No es lo mismo que graduar.** Graduar pasa a canon lo que la tarea CAMBIÓ, cuando se mergea. Esto es
lo que la tarea ENCONTRÓ que ya existía y nadie había escrito: no espera a que la tarea termine, porque
el siguiente que lo busque no tiene por qué saber que está enterrado en una tarea.

⚠ **Jev ya no está en el tablero** (retirado el 2026-09-23, a pedido de Miguel): el **✦ Orientar** de
la cabecera, el **✦** de Pendientes y el laboratorio `make tablero-jev` agregaban ruido sin un uso que
lo justificara. Queda sólo la conexión con su API —`tools/jev_transport.py`, con pruebas offline en
`make tablero-jev-test`— para cuando aterrice un uso mejor. No la vuelvas a cablear a la interfaz sin
ese uso decidido con Miguel.

Al terminar, agregá el bloque del día y corregí en el documento lo que dejó de ser cierto —el plan, el
material, los pendientes—, como dicta esta guía. Si aprendiste una regla que seguiría siendo cierta
después del merge, graduála a **canon**; si no, queda en la tarea. Así la siguiente sesión empieza con contexto verificable, no con una transcripción
del chat anterior.

⚠ **Y la regla que hace que esto sirva: la evidencia va CON SU COMANDO.** No es una preferencia de
estilo — el validador de la pila lo EXIGE: un bloque que trae una prueba o una consulta la lleva en su
caja (` ```harness `, ` ```trazador `, ` ```sql prod `, ` ```sh `), con el ambiente en su `TARGET=` o en
el `sql <ambiente>`, y debajo su `Resultado:`. «En producción son 14.160» menciona un ambiente sin decir
dónde se midió; un bloque así no entra.

**Medido el 2026-09-18, sobre las anotaciones que había entonces en los documentos, y el problema no era
el hábito de anotar:**

    350 anotaciones · 245 de ellas MEDICIÓN
    308 (88 %) tienen continuación   ← anotar está instalado
     51 (14 %) producen una FUENTE   ← lo que se escribe debajo es prosa, no el comando
     11 (3 %)  dicen el ambiente     ← «medido en prod» y «en local» no son lo mismo

O sea: el mecanismo estaba construido, con su UI, y vacío en el 86 % de los casos. Y una medición sin
comando es un número que nadie puede volver a tomar — así que nadie lo desmiente, y envejece haciéndose
pasar por cierto. Por eso el bloque no es opcional en esto: sin comando y resultado, lo que se escribe
es prosa.

**Lo que más rinde para cerrar ese hueco es que la herramienta emita la medición**, en vez de que
alguien la escriba: donde hay que escribirla a mano sale prosa, y donde la emite la herramienta sale el
comando. **Desde el 2026-09-23 la agregan solas a la pila, con `BLOQUE=<id|slug>`**: el trazador para el
recorrido de una solicitud, `tablero-db` para SQL y el arnés (`harness-caso` · `-listado` · `-caminar` ·
`-suite`), que era el hueco más grande —aparece en **33 de 68** tareas, el doble que el trazador—. El
bloque lleva `via` con el nombre de la herramienta, el título con el resumen de la corrida y el comando
exacto en su caja con lo que dio; entra por `make tarea-bloque`, así que pasa por el mismo validador que
uno escrito a mano. `MD=1` sigue imprimiendo la anotación, para los documentos que no son una tarea —un
`CLAUDE.md`, una trampa—; en una tarea, el lint la frena.

⚠ **Y lo que NO cambia es la frontera.** La medición se publica; la herramienta, no. Eso ya está
resuelto arriba, en «La frontera del guard está DENTRO del archivo»: a `## Tarea (publicable)` va *«se
consultó producción: el 12 % de las solicitudes…»*, nunca el SQL ni el comando que lo ejecutó. Las
herramientas repiten ese enlace en su propia sección para que no se reinvente la regla en cada lado.

## El código del tablero se nombra en inglés

Identificadores, archivos, carpetas y claves JSON del código del tablero van en inglés; los
comentarios, las tareas de `tasks/` (incluido su frontmatter) y los mensajes de consola siguen en
español. Se quedan como nombres propios `tablero`, `trazador`, `cuadrilla`, los targets de `make`, la
etiqueta del agente del pulso y `tema.css`/`taller.css`, los dos archivos del sistema de diseño que
comparten las tres UIs (fuente en `tools/ui/`; decisión de Miguel del 2026-09-23). Las claves JSON pasaron a inglés el 2026-09-23 (fase 4b, con el contrato
subido a `tablero.task.v2`, y ese mismo día a `v3` al entrar la pila); quedan en español sólo las que son el contrato de OTRO —la respuesta de
canon, la API de cuadrilla, Jira, el frontmatter— y cada una está aceptada con su alcance en
`tools/naming-allow.txt` (`json: <ruta>[:<tipo>] <claves>`), no como palabra suelta.

**`make tablero-naming` lo verifica** y sale 1 ante un nombre nuevo que no es inglés. Revisa los
identificadores declarados en Go, Vue/JS y Python, las claves JSON que emite el server (etiquetas y
mapas literales, por AST) y los nombres de archivo y carpeta, y dice cuántos leyó de cada fuente: una
fuente vacía es un error, no un verde. `make tablero-naming-test` fija su lógica, incluido un nombre
español inventado en cada lenguaje y una clave aceptada en un lugar que no queda aceptada en otro.

⚠ **La vara del inglés es la stdlib de Go y de Python, no el diccionario del sistema**, que trae inglés
arcaico y deja pasar `aviso`, `leer` o `tema`. Lo legítimo que la vara no conoce va a
`tools/naming-allow.txt`, en su categoría. La pregunta antes de agregar una línea es una sola: ¿es
inglés o un nombre propio? Si es español, se renombra: `tools/rename/` tiene los renombradores de Go
(sobre el type checker), Vue/JS y Python, que rechazan todo rename que sombree, y las comparaciones
viejo-contra-nuevo (`ab-cli.sh`, `ab-web.sh`, `ab-py.sh`, `ab-make.sh`) que prueban que nada visible
cambió. ⚠ Y su límite conocido: un falso amigo (`taller`, `once`, `red`) pasa igual que el inglés.

## Reglas de trabajo

- **Una tarea de producto o del equipo = un archivo ligado a Jira.** Si todavía no se decidió publicar
  un frente general, se trabaja dentro de `playground.md`; al comprometerlo, se crea o vincula Jira y
  sale de esa lista. No se crea un archivo local intermedio por cada idea.
- **Sólo existen siete tareas locales permanentes:** `canon.md`, `context.md`, `harness.md`,
  `tablero.md`, `trazador.md`, `workers.md` y `playground.md` (`context` y `workers` quedan por su
  historia: las dos carpetas se retiraron, el 2026-09-21 y el 2026-09-24). Una mejora de una herramienta se agrega
  a su archivo; una mejora transversal o sin destino va a `playground`. El lint y `make tareas` validan
  esta lista para que no dependa de acordarse.
- **El estado vigente se reescribe y los frentes se consolidan.** No apiles una tarea nueva por cada
  mejora de la misma herramienta. Dentro del contenedor, cada frente conserva objetivo y condición de
  cierre; al terminar, lo que pasó queda en un bloque de la pila y el frente se retira de los pendientes.
- **JSON es una proyección, no otro archivo para editar.** `make tarea-json N=<slug|id>` deriva el
  contrato `tablero.task.v3` desde el Markdown y la pila: el documento (pendientes, secciones, la
  publicable) y `stack`, los bloques del más nuevo al más viejo. Workers y automatizaciones consumen esa
  vista; la explicación y la evidencia siguen teniendo una sola fuente. No crees sidecars manuales.
  *(v3 desde el 2026-09-23: se fueron `state` —la retoma y el próximo paso— y `annotations`, que ese día
  pasaron a la pila.)*
- **Las tareas locales son `clase: proyecto`, nunca llevan Jira ni sección publicable.** Las tareas
  ligadas a Jira usan `clase: tarea` —el default— y pueden conservar el cuerpo privado y el borrador
  publicable. El botón «Mover» sólo aparece para Jira.
- ⚠ **Antes de crear cualquier archivo, corré `make tareas TODAS=1`.** Para trabajo local casi siempre
  hay que editar uno de los siete contenedores. Para trabajo de producto, primero verificá si el issue
  ya está registrado.

- **Frontmatter**: `id` · `title` · `clase?` (`tarea`|`proyecto`, default `tarea`) · `stage` (`evaluation`|`work`|`tasks`) · `created` ·
  `archived?` · `canon[]` · `jira[]` · `jira_title` · `ramas?` (uno o varios patrones, por
  coma). Archivar = poner `archived`, no
  mover el archivo.
- **La frontera del guard está DENTRO del archivo.** El cuerpo es privado y puede nombrar repos,
  rutas y F-xx. **Lo único que se publica** es `jira_title` + la sección `## Tarea (publicable)`,
  y pasa el guard del server (rechaza repos, rutas de archivo y F-xx). No muevas esa marca ni
  metas detalle técnico debajo de ella.

  ⚠ Y el guard **no** es la regla de qué escribir, sólo de qué no filtrar: son 8 regex (`F-\d+`,
  `playground`, unos nombres de repo, rutas con extensión, comentarios HTML, y —desde el 2026-09-15— el
  vocabulario de **mis herramientas**: `make <target>`, `E2E_TARGET`, `trazador`/`credibot`/`cuadrilla`,
  `localhost` y los puertos locales). Un texto lleno de nombres de tabla, SQL y clases de Laravel **pasa
  el guard entero**. El registro de cada pieza lo define la lista de abajo, no el guard.

  **Lo que se comparte es QUÉ se hizo, no CON QUÉ.** Las herramientas son de Miguel y nadie más las
  corre: nombrarlas en Jira manda al lector a algo que no tiene, y hace parecer que la prueba depende de
  una herramienta personal. Lo que SÍ va, y en general: se recorrió el flujo de punta a punta, se
  consultó producción, se corrió la migración, se sembró la fila de configuración. Por eso cada motivo
  del guard dice **con qué reemplazarlo** — uno que sólo prohíbe hace borrar información; uno que
  traduce la conserva. Para lo de datos hay sección propia en la publicable: «Cambios en datos».

  ⚠ Los patrones son ESPECÍFICOS a propósito, y lo que quedó AFUERA importa tanto como lo de adentro:
  `canon` es el pago mensual del renting (6 tareas lo usan así), `panel` es el de administración del
  producto, `suite` es la de PHPUnit del repo real y `plantillas` son las del contrato. Buscar palabras
  comunes daba **7 falsos positivos** sobre las 32 publicables reales, todos legítimos; con los patrones
  que quedaron no se frena **ninguna** — son red de seguridad, no un cambio de reglas.

- **La forma del cuerpo está en `TASK-TEMPLATE.md`** (en la raíz de `tablero/`, NO en `data/`: ahí
  todo `.md` se lee como tarea). Copiala para una tarea nueva. No es decoración: existe para que
  **retomar en frío sea rápido**, y su única regla estructural sale de medir por qué las tareas grandes
  se vuelven ilegibles.

  **Hay CINCO clases de contenido, y cada una se trata distinto. Tres tienen nombre propio en el
  archivo; las otras dos son las que lo desordenan cuando no se las reconoce:**

      1 ESTADO       dónde estoy hoy            → lo dicen los últimos bloques (y, si ayuda, un párrafo arriba)
      2 PLAN         objetivo, cómo se ataca    → se REESCRIBE   «Objetivo» · «Cómo se ataca» · «Lo que se evaluó»
      3 MATERIAL     recetas, consultas, datos  → se MANTIENE    «Cómo se comprueba — y el MATERIAL…»
      4 BLOQUES      qué se fue documentando    → se APILA       `tasks/<slug>/context.jsonl`
      5 CONOCIMIENTO cómo funciona el sistema   → GRADÚA         a un tema de canon

  **La que más se equivoca es la 4 disfrazada de 3**: el diario de ejecución escrito como sección nueva
  arriba («🔧 Segunda pasada (13/9)», «2ª revisión de Santi (3/8)»). Medido el 2026-09-15 sobre las 40
  abiertas: la mediana pesa 16 KB y está sana, pero **11 pasan de 40 KB y 6 de 80**, y las grandes no
  crecieron por mezclar el estado con un diario, no por la historia que debería vivir estructurada:
  **91 de sus 621 secciones llevan fecha**, y en la peor son 21 de 72.

  ⚠ **Tener fecha NO condena a una sección.** «Cómo se prueba, de cero (verificado el 2026-08-20)» es
  MATERIAL vigente y la fecha dice cuándo se comprobó. El test que discrimina es el mismo de siempre:
  **si esto se mergea mañana, ¿sigue siendo cierto?** Sí y es de la tarea → queda. Sí y es del sistema →
  gradúa a canon. No → es un bloque de esta tarea, en su pila.

  **`make anatomia`** mide esto por tarea —tamaño, secciones, bloques en la pila y qué secciones con
  fecha quedaron en el documento— y no mueve nada: señala para que alguien mire. `N=<id>` para una sola.

  ⚠ A propósito **el lint NO avisa por tamaño**: corre en cada escritura y tiene que hablar de lo que
  está MAL, no de lo que está grande. Un archivo de 80 KB puede ser correcto; que convenga partirlo es
  un juicio, y los juicios van a `make anatomia`, que se mira cuando uno quiere mirarlos.

  Medido el 2026-08-19 sobre las 41 tareas: las dos más grandes —130 KB con 60 secciones y 84 KB con
  55— eran ilegibles **no por largas, sino por mezclarlas**: cada día se apilaba una sección nueva al
  final del estado, y nadie sabía cuál de las tres «decisiones» sobre lo mismo seguía vigente. Es lo que
  resolvió la pila: la historia salió del documento (el 2026-09-23 las dos más grandes bajaron de 190 y
  167 KB a 90 y 98).

  El orden de las secciones es el orden en que las necesita quien llega sin contexto:

      Pendientes                                 ← casillas concretas, lo abierto y lo cerrado
      Objetivo · Dónde se toca · Cómo se ataca
      Lo que se evaluó y NO se eligió            ← lo que evita re-proponer lo que ya falló
      Lo que NO entra · Cómo se comprueba
      Referencias                                ← contexto estable, PRs y enlaces
      ## Tarea (publicable)                      ← de acá abajo, lo único que sale a Jira
      la pila de bloques                         ← fuera del Markdown: lo que pasó, se midió, se decidió

  La distribución en la interfaz sigue la [plantilla por pestaña](#plantilla-por-pestaña).
  Se aplica al crear o actualizar una tarea abierta.

  Tres reglas de uso, que son las que un agente incumple si no están escritas:
  1. **Al terminar de trabajar se apila un bloque** con lo que se hizo; no se agrega una sección nueva al
     documento. El documento se corrige cuando cambia lo vigente: objetivo, plan, pendientes.
  2. **La pila no es la bitácora.** La pila dice **qué pasó**; la bitácora (`data/entries/`, lo que sube
     al worklog) dice cuánto tiempo llevó. Chocaban cuando el registro vivía en el cuerpo y las tareas
     viejas lo llamaban `## Bitácora`: medido, el esfuerzo #5 tenía 4 entradas ahí y **0** en
     `data/entries/`.
  3. **Las tareas ya publicadas NO se migran.** Decisión de Miguel (2026-08-20): hay demasiadas
     terminadas y reescribirlas no aporta. La plantilla rige para las nuevas y para las que sigan
     abiertas cuando se les vuelva a meter mano.

- **CINCO piezas, cinco preguntas distintas.** El título es lo único compartido; el resto no se repite
  entre piezas. La prueba para saber dónde va algo es **quién lo lee y qué necesita**:

  | pieza | contesta | la lee |
  |---|---|---|
  | `title` / `jira_title` | ¿cómo se llama esto? | todos — es el nombre compartido |
  | **el cuerpo** (privado) | **¿cómo se está atacando?** los caminos evaluados, por qué se descartó cada uno, contra qué se comprobó | vos, y un modelo que retoma la tarea |
  | **la pila** (`context.jsonl`) | los HECHOS con fecha que la prosa no conserva: qué pasó, qué se midió, qué se decidió | quien vuelve tres semanas después |
  | **avances** (`data/entries/`) | ¿en qué se fue el tiempo y qué pasó ese día? | vos, y el worklog de Jira |
  | **`## Tarea (publicable)`** | qué problema resuelve (**producto**) + **cómo se prueba** (**QA**) | el equipo, vía Jira |

  1. **La publicable NO es un resumen del cuerpo.** Es otro público y otra pregunta. El cuerpo explica
     *cómo se está resolviendo*; la publicable, *qué se logra y cómo se verifica*. Si al escribirla te
     sale «migración idempotente que resuelve los campos por nombre», eso es cuerpo — a producto le
     importa que el campo aparezca en cascada, no que el script se pueda correr dos veces.
  2. **La publicable tiene DOS mitades, y la plantilla ya existe** — no la inventes. Es la que usan
     Ábaco, la card de renting y el codeudor, y sale de medir, no de opinar:

         ## En una línea      ── producto: qué se logra, en una oración
         ## Por qué           ── producto: el motivo de negocio
         ## Qué cambia        ── producto: el cambio que se ve
         ## Alcance           ── producto: los límites (qué NO entra)
         ## Dónde probar      ── QA: ambiente, comercio, entidad, usuario
         ## Cómo validar      ── QA: los pasos, con los datos concretos
         ## Cambios en datos  ── QA: migraciones, backfill, filas de config, consultas para verificar
         ## Criterios de aceptación   ── QA: cómo se sabe que pasó
         ## Dependencias / contraparte ── QA: qué falta de afuera, y de quién

     Basta con que esté la mitad de QA para que `make tareas N=<x>` no se queje: en una tarea chica,
     «Cómo validar» sola ya deja a QA sin preguntas. Medido el 2026-08-19 sobre las 16 tareas de los
     últimos 4 sprints: **4 de 9 publicables tienen esa mitad y 5 son prosa suelta**, y 3 tareas no
     tienen sección publicable —así que de esas no sale nada a Jira—. La plantilla no es una propuesta:
     es lo que hacen las que quedaron bien.
  3. **Lo que se evaluó y se descartó va en el cuerpo, y va aunque no se haya elegido.** Es lo que
     evita re-discutir el mismo camino en tres semanas, y es lo que un modelo necesita para no proponer
     de nuevo lo que ya se probó y falló. Hoy lo registran 6 de 12 tareas: cuando está, se nota.
  4. **Una decisión, una medición, una pregunta abierta o un riesgo NO son prosa del documento: son
     bloques de la pila.** Con fecha y con el comando que lo vuelve a comprobar, porque la prosa se lee
     bien el día que se escribe y miente tres semanas después. Si escribiste «medimos que…» en el
     documento, eso quería ser un bloque. *(Hasta el 2026-09-23 eran anotaciones en el cuerpo.)*
  5. **El avance no repite el cuerpo**: dice *en qué se fue el tiempo*. El cuerpo dice **en qué** se
     trabaja, los avances **cuándo y cuánto**, y el pulso —que nadie escribe a mano— **cuándo se tocó
     código de verdad**. Tres cosas distintas: si la nota del avance explica una decisión, esa
     decisión va a la pila (o al plan del cuerpo) y la nota se queda con el hecho del día.
  6. ⚠ **Al medir esto, cuidado con dónde termina la publicable: va del marcador hasta el FINAL del
     archivo.** Sus subtítulos son `##`, del mismo nivel que el marcador, así que un lookahead al
     próximo `##` la corta en la primera línea y da cero. Es exactamente el error que se cometió el
     2026-08-19 midiéndola: dio «7 de 12 sin publicable» cuando eran 3. El server lo hace bien
     (`cuerpo[loc[1]:]`); si escribís una medición aparte, copiá ese criterio.
- ⚠ **AL CERRAR UNA SESIÓN DE TRABAJO, tres cosas.** No es una lista de buenas intenciones: el 26/8 se
  olvidaron todas mientras se mergeaban PRs y se corrían migraciones, y el tablero mintió ocho días.

  1. **Agregá un bloque del día** con `make tarea-bloque`, en la tarea **con `id`** (la que el tablero
     muestra): el título con la conclusión y la descripción con lo que la sostiene —archivos por repo,
     canon, el comando y lo que dio—. Lo que se descartó entra como un bloque con su motivo, no como prosa
     de sesión.
  2. **Declará `ramas:`** apenas exista la primera rama, y volvé a medir con `make tareas-ramas`. El
     patrón es lo ÚNICO que se escribe a mano; dónde vive cada rama y su PR lo mide git. Sin patrón,
     la consola Ramas no tiene una medición propia de la tarea.
  3. **Escribí la bitácora con `make bitacora-add`**, no a mano: pone el id, el día y la hora, resuelve
     la tarea por id o slug, y **los minutos salen de UNA fuente que queda escrita en la nota**:
     `LAPSO=HH:MM-HH:MM` (la sesión), `PULSO=HH:MM` (tramos de 5′ con cambios desde esa hora) o
     `MIN=N FUENTE='…'`. Sin fuente no escribe. ⚠ **Los minutos se MIDEN, no se estiman**: inventar un
     número ahí es peor que dejarlo vacío, porque después se sube a Jira. *(Hasta el 2026-09-14 esto se
     escribía como JSON a mano en `data/entries/<YYYY-MM>.jsonl` y así salieron 211′ sin tarea en un
     mes; el formato sigue siendo ese, pero lo escribe el store.)*

  ⚠ **Y decilo cuando no puedas medirlo.** Si el pulso no tiene datos de ese día, la entrada sale del
  lapso de commits y eso se avisa: quien lee la bitácora tiene que poder saber de dónde salió el número.

  *(Hasta el 2026-09-23 eran cuatro: además, reescribir la sección de retoma con un «próximo paso». Se
  fueron con la pila de bloques.)*

  **Y desde el 2026-09-14 esto NO es una lista: es `make cierre`.** Cruza git (qué documentos de tarea
  se tocaron), la pila (qué tareas tienen un bloque fechado ese día: cuenta la FECHA del bloque, no el
  archivo, así que la migración que reescribió los hitos viejos no volvió «tocadas» a sus 22 tareas), el
  pulso (qué ramas se tocaron → qué tarea las declara en `ramas:`, y cuáles ninguna) y la bitácora del
  día (minutos por tarea, y los que no tienen dueño). Sale 1 si a una tarea tocada le falta una pieza. Medido el día que
  se escribió: 23 de las 39 abiertas no tenían sección de retoma, 27 no tenían próximo paso y 3 con
  trabajo en septiembre no tenían bitácora — la lista de arriba llevaba un mes escrita.
  ⚠ **Tocar el archivo no es trabajar en la tarea: si lo único que cambió es el FRONTMATTER** —declarar
  `ramas:`, marcar `clase: proyecto`, corregir un id— **el cierre no reclama nada.** Lo mide comparando
  el cuerpo de hoy con el del último commit anterior al día. Sin eso, marcar ocho tareas como proyecto
  (una línea cada una) hizo que le reclamara a cinco reescribir el estado, apilar Registro y anotar
  bitácora por un cambio que no dice nada nuevo de la tarea (2026-09-15). Un aviso que reclama de más se
  empieza a ignorar, y ahí deja de servir para lo que existe.
  ⚠ **Y el caso hermano: un BARRIDO sí toca el cuerpo, y tampoco es trabajo.** El 2026-09-21, apagar
  el árbol de contexto renombró un campo del frontmatter y reapuntó rutas en las 45 tareas, y a tres
  el cierre les reclamó bitácora. Anotarla habría inventado minutos y, peor, los habría contado DOS
  veces: ese tiempo ya estaba en la tarea del barrido, y el total del día sube a Jira. Para eso, el
  **commit** del barrido lo declara con un trailer:

      git commit -m "tablero: la ruta a las trampas cambia de carpeta" \
                 -m "Sin-avance: sólo se reapuntó la ruta a las trampas del sistema"

  Una tarea que sólo tocaron commits con `Sin-avance:` no está tocada: el cierre no le pide bloque ni
  bitácora, y la lista aparte —`— barridas, sin avance`— con el motivo, nunca con un ✓: un tilde diría
  que las piezas están, y no están. Tampoco la despierta en `make hoy`. Si ese mismo día hubo trabajo de
  verdad en la tarea, cuenta el trabajo. Lo sin commitear no tiene trailer: hasta que se commitea, el
  barrido se ve como un toque.
  *(Hasta el 2026-09-23 se declaraba en la tarea, con una línea `> **<día> · sin avance.** …` en la
  entrada del día de su `## Registro`. Ese día el Registro se fue a la pila y la declaración pasó al
  commit, que es donde se hizo el barrido: treinta tareas barridas ya no dicen treinta veces lo mismo.)*
  ⚠ **Se declara, NO se deduce.** Se probó deducirlo comparando el cuerpo con las citas normalizadas
  («si sólo cambiaron rutas, nadie afirmó nada») y falla en los tres casos que venía a resolver: al
  barrer se escribe la nota que explica el barrido, así que la prosa fuera de los backticks también
  cambia.

  ⚠ **Y hay una QUINTA cosa, pero avisa y NO frena** (desde el 2026-09-18): si la tarea declara
  `ramas:` —o sea que hubo código— y en todo el archivo no hay un solo comando reconocible, el cierre
  saca `▲ tocó código y no dice con QUÉ se comprobó`. Sale con `▲` y no con `✗` a propósito, y no suma
  a las piezas faltantes: hay tareas de diseño o de lectura donde no hay nada que correr, y convertir
  eso en un error enseña a ignorar el cierre entero, incluidas las cuatro que sí importan. Mira dos
  lados: un bloque de la pila con un comando y su resultado, o un comando reconocible en el documento
  (`store.SourcesOf`, sobre «Cómo se comprueba» y el resto del cuerpo). Medido al escribirlo: de las 29
  tareas con ramas, **6** lo dispararían.

  El hook de `Stop` (`closeout`, en `server/internal/hooks`) lo corre solo al terminar cada respuesta y, **una vez
  por sesión**, frena con la lista de lo que falta en las tareas que ESA sesión tocó. ⚠ Y **leer un
  archivo no es tocarlo**: el hook exige que la ruta esté pegada al verbo que la escribe (`>`, `tee`,
  `sed -i`, `git add`, `open(…,'w')`) o que venga de un Write/Edit. Si te frena en el
  medio del trabajo, decilo en una línea y seguí: no vuelve a hablar.

- **El test de enrutamiento**: *si esto se mergea mañana, ¿sigue siendo cierto?* Sí → es contexto,
  va a **canon**. Habla de decisiones, riesgos o preguntas de ESTA tarea → va acá. Al mergear,
  lo aprendido **gradúa** al nodo y la tarea se archiva.
- **El tablero se lee por CONSOLA, sin levantar nada** — su propio dominio, no el de terceros:

      make tareas                       las abiertas, con etapa, Jira y nodos
      make tareas N=kyc-segundo         una: separa lo PÚBLICO de lo PRIVADO y chequea el guard
      make tareas STAGE=work TODAS=1 JSON=1
      make tarea-json N=tablero         una tarea —documento y pila— en el contrato tipado `tablero.task.v3`
      make tareas-guard F=<archivo>     ¿este texto puede salir a Jira? SALE 1 si no
      make sprint                       el sprint activo con puntos, del SNAPSHOT
      make bitacora DAYS=7              el tiempo registrado, por día
      make tareas-ramas                 en qué ramas vive cada tarea y hasta dónde llegó (mide git)
      make tareas-ramas N=43 JSON=1     una sola, en json
      make hoy                          la agenda: el último bloque de cada tarea viva, preguntas vencidas, entrega, dormidas
      make retomar N=84                 retomar UNA en frío: sólo lo que hace falta para arrancar, y qué le falta
      make retomar N=47 BRIEF=1         …y al final la ficha de sus referencias de Canon (hasta 4; BRIEF=a,b elige)
      make cierre                       el cierre del día: a qué tarea tocada le falta qué. DIA=… · JSON=1
      make bitacora-add TAREA=84 …      anotar la bitácora con minutos medidos por el comando
      make tarea-bloque N=84 ARCHIVO=…  apilar un bloque —título y descripción— validado desde un Markdown
      make tarea-context N=84           leer la pila de una tarea
      make deploys DIAS=7               qué se desplegó y a qué ambiente
      make deploys FALLAS=1             SÓLO lo que falló, con el error del log — «¿qué se rompió?»

  El `-guard` reusa `connectors/guard`, que es la fuente única (la UI compila esos mismos patrones y
  `issue-create` los aplica al publicar). Correlo ANTES de escribir lo publicable, no después: el
  cuerpo de una tarea NUNCA pasa —nombra el playground, repos y rutas—, y esa es justamente la
  frontera. Que salga con código 1 es a propósito: sirve para frenar, no sólo para informar.

- **Jira y Slack tienen TRES caminos**, no dos: el server (`npm run dev` → :8787, botones con vista
  previa), los conectores MCP (`cmd/jira-mcp`, stdio — sólo si están registrados) y **la CONSOLA**,
  que es la que sirve cuando no hay UI a mano y **no depende del server corriendo**:

      make jira-create JSON=t.json     # crea y mete al sprint activo; el único que puede ESTIMAR
      make jira-move KEY=CORE-309 A=prueba
      make jira-edit JSON=t.json

  ⚠ El `status` de `jira-create` es una lista **ORDENADA** de subcadenas, no un destino suelto: el
  workflow de CORE no deja saltar estados. *(Acá decía «para pruebas hay que pasar por progreso
  primero». Está mal, medido el 2026-08-19 contra `GET /issue/{key}/transitions`: **a «En pruebas» no
  se llega desde ningún estado salvo «Terminada»**, y esa transición se llama «Se devuelve a pruebas»
  — es un retorno. El camino real es Por Hacer → En progreso → En revisión → Terminada.)*
  Y por consola es el único camino que **estima**: el del server crea y mete al sprint pero no tiene
  campo de puntos.
- **Las transiciones disponibles se le preguntan a Jira.** El icono de la fila llama a
  `GET /api/transitions` para ESE issue y reduce las salidas al único avance normal de CORE:
  *Por Hacer → En progreso → En revisión → Terminada*; Bloqueada y En pruebas se reincorporan al
  cauce. No ofrece invalidar, pausar ni retroceder. Es la lección de haberlo hecho al revés: el botón
  anterior estaba cableado a «A pruebas» y **fallaba en 5 de los 6 estados**, porque esa transición
  sólo existe desde «Terminada». Dos detalles del diseño:
  1. El destino que cae en el estado de pruebas **no se mueve directo**: entra al flujo de QA, donde
     mover el issue y avisarle a quien valida son un mismo acto y el mensaje se previsualiza (pasa el
     mismo guard que la bitácora). Se marca «+ aviso» en el menú para que no sorprenda.
  2. El POST **re-lee las transiciones antes de aplicar**: si alguien movió el issue desde Jira con el
     menú abierto, el id queda viejo y Jira devuelve un 400 ilegible. Así se contesta 409 con el porqué.

  Los tres necesitan `ATLASSIAN_*` en `tablero/.env`. Tareas nuevas van al **sprint activo del board
  384**, no al backlog. **Nada se publica sin que Miguel lo vea antes** — los tres escriben hacia
  afuera y lo ve el equipo.
- **UNA TAREA ES UNA CARPETA** (desde el 2026-09-23): `tasks/<slug>/` con su documento `task.md`, su
  pila `context.jsonl` y sus `artifacts/`. `data/` quedó para lo operativo —bitácora, pulso, cachés y
  las trampas—. Hasta ese día las tareas eran `data/<slug>.md` sueltos y lo demás se
  les unía POR NOMBRE, y la convención falló en silencio: 13 de 21 artifacts no eran `.html` y no se
  veían nunca, y uno quedó huérfano cinco semanas porque su tarea se renombró. Una carpeta se renombra
  con todo lo que tiene adentro. **Dónde vive cada cosa lo sabe un solo lugar: el paquete
  `server/internal/layout`**; no vuelvas a armar `../data/<algo>` a mano en un comando.
  ⚠ Y renombrar o mover una tarea NO es tocarla: «días sin tocar» y el cierre salen de git siguiendo
  las mudanzas (un movimiento puro, R100, no cuenta; mover y editar a la vez, sí). Sin eso, el día de
  la mudanza las 46 tareas habrían amanecido «tocadas hoy».
- `data/entries/*.jsonl` (bitácora de tiempo), `data/pulse/*.jsonl` (el pulso) y `data/cache/` están
  **fuera de git** a propósito (dato personal / snapshot descartable); las carpetas de `tasks/` **sí**
  se versionan. No lo cambies. *(`settings.json` también se versionaba: eran los flags del engranaje,
  que se fue el 2026-08-18; nadie lo leía y se borró el 2026-09-23.)*
- **ARTIFACTS: todo lo que haya en `tasks/<slug>/artifacts/`** —prototipos, consultas, notas—. El
  panel de la tarea muestra la pestaña **Artifacts** con la lista; cada uno se sirve en
  `GET /artifacts/<slug>/<archivo>`, con su tipo (la extensión) al lado. La etiqueta es el nombre sin
  extensión ni el prefijo `<slug>.`: `<slug>.html` se etiqueta «prototipo», `<slug>.<variante>.html`
  toma la variante, y un punto que quede separa grupo y parte (« · »). Para un prototipo, tres reglas:
  1. **Un HTML autocontenido, sin build.** Si necesita `npm install`, no es un artefacto: es una
     carpeta del playground con su entrada en el `Makefile`.
  2. **Lleva la fecha visible adentro.** Un prototipo sin fecha se lee como estado actual; con fecha
     se lee como lo que es — lo que se acordó ese día.
  3. **No gradúa a canon.** Describe lo propuesto, no cómo funciona CreditOp: muere con la
     tarea. Si algo de ahí resultó verdad perenne, se escribe en el nodo con palabras.
- **RAMAS: se declaran los PATRONES, el resto lo mide git.** `ramas: pais-como-dato` en el frontmatter
  —o varios separados por coma— y `make tareas-ramas` responde en qué ramas de qué repos vive la tarea,
  **en qué ambientes ya está el cambio** y **en qué estado está su PR**. Igual que los artifacts (son lo
  que hay en la carpeta) y los pendientes (salen del cuerpo): una lista de ramas escrita a mano **miente
  en silencio** en cuanto algo se mergea o se renombra. Medido el 2026-08-19 grepeando las 16 tareas de
  los últimos 4 sprints: de los nombres de rama que aparecen escritos en los cuerpos, **dos no resuelven
  hoy** — uno porque la rama se renombró (`codebtor-` → `cosigner-`, el cuerpo lo aclara al lado, pero un
  grep encuentra el viejo) y otro porque la remota se borró al mergear el PR. Seis reglas:
  1. **Se mide por PATCH-ID** (`git cherry`), no por nombre de rama: así se detecta un cambio que llegó
     por **squash**, donde el hash cambia y la rama ya no existe. Es cómo se supo que el backend de
     países estaba en `develop` y `staging` pero no en `main`.
     ⚠ **Pero el patch-id solo NO alcanza, y el agujero es grande: un squash cuyo mensaje o contenido se
     editaron al mergear cambia el patch, y la rama pasa a figurar «en ningún ambiente» aunque su
     cambio esté en `main`.** Medido el 2026-09-15: `frontend-monorepo#983`, squasheado a `3f3f8700`,
     estaba en `main` hacía un día y el tablero decía que no — y la tarea de Alta Fleet afirmaba, con esa
     medición, que nada suyo había llegado. Por eso hay una **segunda señal**: si el PR se mergeó y su
     commit resultante ya es ancestro del ambiente, el cambio está. Cada ✓ guarda **cómo se supo**
     (`como: patch | pr`) y la tabla marca distinto los que vinieron por el PR: un dato que no se puede
     explicar no se puede defender.
  2. **La señal es «¿está la PUNTA en el ambiente?»**, no «¿le queda algo propio?». Lo segundo engaña:
     una rama cortada de `main` arrastra ~190 commits ajenos contra `develop` y decir «falta en
     develop(190)» sugiere 190 pendientes cuando el pendiente es uno.
  3. **El patrón puede ser una LISTA** porque la relación rama↔tarea es muchos-a-muchos: acá las ramas se
     cortan unas de otras, así que una rama carga trabajo de varias tareas y una tarea vive en varias.
     Medido: CORE-268 vive en `monto-actualizando-sin-banner` **y** en `motai-v2`, que no comparten
     ninguna subcadena. Y **no ensanches el patrón** para cubrir dos: `kyc` trae también
     `obs-kyc-03-codes`, que es observabilidad. Un patrón ancho no falla, miente.
  4. **Incluye las ramas LOCALES, marcadas.** Antes sólo miraba remotas y eso tenía un agujero
     sistemático: al aprobar un PR la remota se borra, así que dejaba de encontrar nada justo para las
     tareas TERMINADAS. `local` **no** quiere decir «sin pushear» — los ambientes dicen cuál de las dos es
     (la de Credifamilia sale «local» y a la vez «ya está en main»).
  5. **La parte de git NO habla con la red; la de los PRs SÍ.** Git lee lo que el último `git fetch` dejó
     —si un dato se ve viejo, fetcheá—. Los PRs son UNA llamada a `gh` por repo **más una por cada rama
     que esa llamada no cubrió**, y **degradan sin ruido**: sin `gh`, sin sesión o sin VPN, las ramas salen
     igual y sólo faltan los PRs. ⚠ La llamada por repo trae los **200 más nuevos**, y eso es una ventana:
     medido el 2026-09-14 llegaba al 24/8 en `legacy-backend` y al 13/8 en `frontend-monorepo`. Antes de
     la búsqueda por rama, 20 de 112 ramas salían «sin PR» —13 ya estaban en `main`— y una tenía un PR
     **abierto contra `main`** que nadie veía (`legacy-backend#1043`). Y `--search head:x` no es exacto
     (trae `x-onto-develop` también): se filtra por nombre después.
  6. **Medir UNA tarea (`-n`) no borra las demás.** Guardaba el resultado tal cual y el snapshot quedaba
     con esa sola: el tablero mostraba que ninguna otra tarea tiene ramas, sin avisar (2026-09-15). Ahora
     se fusiona con lo que había, y **cada tarea lleva su propia fecha de medición**, así que lo viejo se
     ve viejo en vez de heredar la fecha de la última corrida.
  7. **Las tareas que no declaran `ramas:` no se miden — y son la mitad.** `make tareas-ramas SUGERIR=1`
     propone patrones mirando las ramas reales: rankea por lo que comparten de RARO (un trozo que
     aparece en pocas ramas de todo el universo) y por la clave de Jira **del frontmatter**, no del
     cuerpo —el cuerpo menciona las claves de otras tareas—. Es una propuesta, no una medición: el patrón
     sigue siendo lo único que se escribe a mano.
  8. **Es un SNAPSHOT con fecha** (`data/cache/ramas.json`, fuera de git), como el del sprint: un estado
     de git sin fecha se lee como actual y no lo es. La clave es el **id** de la tarea, no el slug,
     porque el nombre del archivo se puede renombrar a mano.

- **AMBIENTES: cada uno tiene su propia ruta para probar, aunque compartan la BD.** Una tarea no
  termina cuando mergea: termina cuando alguien la pudo *probar*, y para eso hay que decir **dónde**.

  **Acá no hay lista de ambientes, a propósito: nacen por necesidad.** `qa` se creó para trabajar
  Motai, y mañana puede haber otro para otra tarea. La fuente es el **workflow de cada repo**
  (`.github/workflows/`): hay un archivo de deploy por ambiente y cada uno declara su rama y su
  servicio. Si querés saber qué ambientes existen HOY, se leen ahí — no acá.

  Lo que sí es estable, y es lo que hay que tener claro al escribir una tarea:

  1. **Comparten la base de datos, no el código.** Medido el 2026-08-20: `dev`, `qa` y `staging`
     apuntan los tres a la **misma** base (`inertia-dev`), pero a **backends distintos**
     (`legacy-backend`, `legacy-backend-qa`, `legacy-backend-stg`) y **fronts distintos**. De ahí las
     dos caras: sembrar un dato o correr una migración **una vez sirve para los tres** —por eso las
     migraciones de Motai aparecen aplicadas en dev y en qa a la vez—, pero **la misma solicitud se
     comporta distinto según a qué backend le pegues**. Probar contra el ambiente equivocado mide la
     rama equivocada (**F-73**).
  2. ⚠ **Nombrar el ambiente no alcanza: hay que saber a qué le habla.** El front desplegado de
     `staging` llama al backend de **`develop`** (`loans-stg.yaml`), no al de staging. Así que «lo
     probé en staging» desde el navegador **no** es lo mismo que apuntarle al backend de staging.
  3. **Prod es otra base y otro disparador.** No se despliega al mergear a `main`: se despliega al
     **taguear** (`on: push: tags` en los dos repos). «Está en `main`» y «está en producción» son dos
     preguntas distintas — y las migraciones de prod hay que correrlas aparte, siempre.
  4. **Mergear no aplica migraciones** en ningún ambiente: el pipeline solo actualiza el servicio y
     las migraciones van por un workflow manual (**F-77**). Si tu tarea lleva una, «mergeada» no es
     «terminada»: el 2026-08-20 eso dejó a producción con el código nuevo y la fila vieja, y el plan
     de pagos salió con una cuota que no era la del contrato.

  **Consecuencia para la publicable:** «Dónde probar» nombra **el ambiente concreto**, no «el ambiente
  de pruebas». QA prueba en dev, en qa y en staging según la tarea, y los tres se ven iguales porque
  muestran los mismos datos — si la sección no lo dice, tiene que adivinar entre tres.

- **DESPLIEGUES: `make deploys` dice el PASO que falló, no «falló».** Es la pregunta del día a día que
  se contestaba abriendo GitHub repo por repo. Sale de `gh`, que ya está autenticado: no hace falta
  ningún token nuevo.

  ⚠ **La distinción que justifica la herramienta:** una corrida en rojo no es «falló el deploy». Medido
  el 2026-09-15 sobre las 8 últimas fallas de `legacy-backend`, dos eran de **Dependabot** (ni siquiera
  son despliegues), tres del deploy a ECS, dos del **análisis de SonarCloud** y una del build de la
  imagen. Leerlas todas igual son cuatro conclusiones equivocadas de ocho. Por eso el ruido de
  dependencias se filtra por el nombre del workflow, y de cada falla se muestra **el job y el paso**.

  > **MEDICIÓN · 2026-09-15** — 201 despliegues en 15 días, 11 fallidos: 7 en «Build Image» y 4 en «Deploy Task Def to ECS»; por ambiente, 6 en qa, 3 en develop y 2 en producción. El deploy a producción del 2026-09-02 se cayó en el paso de **SonarCloud**, porque el scanner no pudo cargar los perfiles de calidad del proyecto — el código estaba bien, falló la herramienta de análisis.
  > `make deploys DIAS=15 JSON=1`

  **`FALLAS=1` es el modo de todos los días**: sólo lo fallido, con el ERROR del log y el enlace. Sin
  él hay que buscar los ✗ entre 122 líneas, de las cuales 106 están en verde — medido, y es justo lo
  que la herramienta venía a evitar. Trae el repo, el ambiente, la rama, el paso y el motivo:

      ✗ 2026-09-10  legacy-backend → develop
         dónde   develop / deploy / Deploy Task Def to ECS → Deploy to Amazon ECS
         por qué Failed to register task definition in ECS: Actual length: '65558'. Max allowed length is '65536' bytes.

  ⚠ **El error sale del marcador `##[error]` del runner, y NO siempre está**: de las 4 fallas de la
  última semana, 3 lo traen y 1 no. Cuando falta hay un respaldo que busca líneas con «error», y si
  tampoco hay **se dice que no se pudo leer** y queda el enlace. Inventar un motivo sería peor: quien lo
  lee dejaría de abrir el log, que es donde está la respuesta.

  El detalle de cada falla se pide EN PARALELO (dos llamadas por falla, una de ellas un log de ~30 KB):
  en fila eran 19 s para tres, ahora 11 s. Un comando que se usa cuando algo se rompió no puede hacer
  esperar.

- **SONAR: «falla el sonar» son DOS cosas distintas, y se consultan distinto.** Credenciales en
  `server/.env`: `SONAR_URL` (`https://sonarcloud.io`), `SONAR_ORG` (`creditop-sas`) y `SONAR_TOKEN`.
  ⚠ El token de hoy es PERSONAL y vence; la propia pantalla de Sonar recomienda un *Scoped Organization
  Token* para automatización de equipo, que no muere con la cuenta de nadie.

  | «falla el sonar» | qué es | cada cuánto |
  |---|---|---|
  | **el PASO del deploy** | el scanner no pudo correr, y **tumba el despliegue entero** | raro: 1 de 40 |
  | **el GATE de calidad** | el análisis corrió bien y el código no pasa el umbral | permanente hoy |

  **1 · El PASO.** `make deploys FALLAS=1` lo muestra con su motivo. El del 2026-09-02 tumbó el deploy
  a **producción** con *«Failed to load the quality profiles of project … An unexpected error occurred.
  Please try again later»* — un fallo del lado de SonarCloud, no del código ni de la configuración (los
  perfiles existen: se comprueba con `api/qualityprofiles/search?project=…`). Se reintenta y pasa.

  **2 · El GATE.** El análisis SÍ corre y publica por rama. Para saber por qué está en rojo:

      source <(grep -E '^SONAR_(URL|ORG|TOKEN)=' tablero/server/.env)
      # qué ramas tienen análisis, cuándo, y su gate
      curl -s -u "$SONAR_TOKEN:" "$SONAR_URL/api/project_branches/list?project=Creditop-SAS_legacy-backend"
      # y POR QUÉ falla el gate de una rama: las condiciones que no pasan
      curl -s -u "$SONAR_TOKEN:" "$SONAR_URL/api/qualitygates/project_status?projectKey=Creditop-SAS_legacy-backend&branch=qa"

  > **MEDICIÓN · 2026-09-15** — `legacy-backend`, rama `qa` (analizada ese mismo día): gate en ERROR por dos condiciones — `new_coverage` en **0,0 %** contra un umbral de 80, y `new_maintainability_rating` en 3 contra 1. O sea que lo que traba el gate es que **el código nuevo no trae pruebas**, no una regla exótica. `legacy-application` en `develop` da OK; `frontend-monorepo` sólo tiene `main`, del 2026-07-03.
  > los dos `curl` de arriba

  ⚠ **LA TRAMPA QUE ME COMÍ, y es la que va a repetir cualquiera:** `api/components/show` devuelve el
  análisis de la **rama principal** del proyecto, y las principales están viejas (`main` de
  `legacy-backend`: 2026-07-10). Con esa consulta los tres repos dan **«lastAnalysisDate: NUNCA»** y se
  concluye que nadie los analiza — que es exactamente lo que afirmé acá antes de mirar las ramas. El
  análisis vivo está en `qa`, `develop` o `lab`. **Siempre preguntar por RAMA.**

- **El pulso NO se escribe a mano ni desde el tablero.** Lo anota `server/cmd/pulse` (un LaunchAgent,
  cada 5 min) leyendo git: es la fuente objetiva de *cuándo toqué código*, y editarla la volvería otra
  bitácora. Se lee con `make pulso` o `GET /api/pulse`. El porqué del diseño: `README.md` → «El pulso».
  Si vas a razonar sobre cuánto se trabajó, mirá el pulso; la bitácora dice **en qué**, no **cuándo**.
