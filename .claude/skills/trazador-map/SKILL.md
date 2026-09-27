---
name: trazador-map
description: Cambiar el CÓDIGO del trazador (trazador/server en Go, la UI en trazador/src): el mapa de etapas como vista (carriles, colores, panel de logs sobre el mapa, layout sin zoom, las realimentaciones de alto y ancho), los tres JSON del mapa (etapas, substeps, ramales) con go:embed, los matchers contra los mensajes que emite el código (trazador/logs.json, make trazador-chequeo) y las pruebas de la lógica que ya dio un diagnóstico equivocado.
---

# trazador · el mapa y su código

Cómo está armado el trazador por dentro y qué no hay que deshacer al tocarlo. Cuándo se usa y cómo se lee
una traza está en `trazador/CLAUDE.md`. Vivía allí hasta el 2026-09-27.

## Cómo está modelado el recorrido

**Las 9 etapas** (el orden es de FLUJO, no de hora) usan el vocabulario del wizard, porque el reporte de
soporte llega en ese idioma («falló en firma de documentos», no «falló en formalization»):

⚠ **Y cuidado al buscarlas en el JSON: los nueve nombres de abajo son el `label`, no el `id`.** En `mapa/etapas.json` cada etapa tiene un `id` en castellano —`origen`, `registro`, `formulario`, `cupo`, `listado`, `seleccion`, `respuesta-lender`, `biometria`, `desembolso`— y el `label` es el vocabulario del wizard. Grepear el mapa por `amount` encuentra un label; el id de esa etapa es `origen`. (El `orden` tampoco es 1-9: va de 10 en 10, con `75`/`78` intercalados.)

`amount` → `authorization` → `personal-info` (incluye burós) → `profiler` → `lenders` →
`selected lender` → `lender response` → `validation` → `disbursement`

**Dos mapas declarativos**, embebidos con `go:embed` (por eso **un cambio de mapa exige recompilar**):

- `mapa/etapas.json` — a qué ETAPA va cada línea de log (matchers por prefijo/exacto/regex), y la
  semántica de los estados de BD: `bd.statuses` (pertenencia) · `bd.close` (prueban que TERMINÓ) ·
  `bd.stop` (la solicitud está adentro y no salió). Esas tres son preguntas distintas y mezclarlas
  produjo dos falsos verdes (ver Gotchas).
- `mapa/substeps.json` — a qué SUB-PASO dentro de la etapa, agrupado en bloques. Tipos: `hitos`
  (patrones de log), `catalogo` (centrales de riesgo declaradas), `familias` (entidades por
  `response_type`).
- `mapa/ramales.json` — qué etapas aplican por familia de lender y por canal; de ahí sale el `no aplica`.

**Cómo se corre** (todo lectura, y las consultas a prod quedan auditadas a nombre del token):

```bash
cd trazador/server
go run . -target prod -ureq 521997          # la traza en árbol
go run . -target prod -ureq 521997 -json    # estructurada
go run . -target prod -sql "SELECT …"       # UNA consulta de solo lectura
go run . -serve 127.0.0.1:5199              # la API que consume la Vue
npm run dev --prefix trazador               # server + UI juntos (:5192)
```

Diagnósticos: `-anclas` (cuánto se puede afirmar de cada línea), `-campos` (censo de campos del contexto
de log), `-spans` (si el `span_id` alcanza para ubicar lo que el texto no reclama).

**El `Ramal` de la traza** (`creditopx` · `agregador` · `redirect` · `credifamilia`) sale del
`response_type` del lender ya sellado en la solicitud, así que **sólo existe después de que el cliente
eligió**: antes de `selected lender` no hay ramal, y eso es un hecho, no un dato faltante. De él cuelga
qué etapas se declaran `no aplica`.

**La evidencia va con el paso.** Cada sub-paso de BD lleva un bloque `Evidencia` con la consulta que
corrió (con el `?` ya resuelto, para pegar en Redash) y las filas que produjeron ese renglón. Se
renderiza aparte de los logs a propósito: una fila de BD es un ESTADO, no un evento — pintarla como log
invita a armar una línea de tiempo con lo que no es una.

## El recorrido se ve en UNA vista: el mapa

⚠ **Al borrarla hubo que traerse lo único que hacía y el mapa no: el recorrido por TECLADO.** Un
`<g @click>` de SVG no recibe foco ni se anuncia a un lector de pantalla, así que cada nodo lleva
`tabindex`, rol de botón y ←/→ para moverse por el orden del flujo. Sin eso, cambiar de vista habría
sido dejar la herramienta sin más forma de navegarla que el mouse.

⚠ **EL CONTENIDO NO ES EL DEL HARNESS; LA FORMA SÍ, Y ESO FUE LO CORRECTO.** Aquél dibuja las 26
**pantallas** que un comercio PUEDE recorrer; éste, las 9 **etapas de negocio** que UNA solicitud
recorrió. Pero el layout —tronco horizontal que se abre en un carril por ramal— se copió del suyo, y la
primera versión de este mapa (una sola columna vertical) estaba peor justamente por no hacerlo: mencionaba
el carril en un pie de página en vez de dibujarlo, o sea perdía la única dimensión que el trazador sabe y
la lista no puede mostrar.

Lo que se tomó del harness, punto por punto: el tronco común que se bifurca **donde de verdad se decide**
(acá, `seleccion`: antes no existe el ramal), un carril por variante, el nodo **hueco = condicional /
sólido = siempre ocurre**, y el carril que no aplica **atenuado en vez de ausente**. El vocabulario de
ramales ya estaba compartido en `ramales.json`.

⚠ **Lo que hubo que cambiar, y es la diferencia real entre las dos herramientas: EL COLOR YA ESTABA
OCUPADO.** En el harness el color dice *qué carril* (verde credit, ámbar renting…); acá tiene que decir
*cómo salió* (verde ok, rojo falló, gris no pasó). No se puede usar el mismo canal para las dos cosas, así
que se separó: **la arista lleva el color del carril y el nodo lleva el del estado.**

⚠ **EL PANEL DE LOGS SE MONTA SOBRE EL MAPA; NO LO EMPUJA.** El mapa tiene **dos anchos y nada más**:
el 100 % con el panel cerrado y el 100 % menos su base (380 px) con el panel abierto. Ensancharlo más
allá de la base **no reduce el mapa: lo tapa**.

El motivo no es estético. El mapa se REDIBUJA cuando cambia su ancho —la separación entre nodos se
recalcula—, así que con el panel empujándolo el dibujo entero se re-arma en cada píxel del arrastre: se
ve como un grafo que late, y la posición de cada nodo deja de ser estable justo cuando uno la está
mirando. Como capa, el mapa se recalcula UNA vez, al abrir o cerrar. Por eso el componente recibe
`cerrado` y no el ancho: observar el ancho traería de vuelta el problema.

Medido: con el panel en 380 el mapa mide 1.219 (`PASO` 133); cerrado, 1.599 (`PASO` 181); y al
ensanchar el panel de 380 a 1.380 el mapa **no se movió**.

⚠ **Cerrar no es un camino de ida:** el tirador queda pegado al borde derecho y sigue agarrable, con
doble clic para abrir y cerrar. Y el arrastre colapsa por UMBRAL (media base) en vez de exigir el cero
exacto: un panel de 40 px no sirve para nada y es imposible de volver a agarrar.

⚠ **Y LA PÁGINA NO SCROLLEA: SCROLLEA CADA PANEL.** La app es una columna flex de alto fijo. Sin eso,
un detalle con cientos de líneas estiraba el documento y **empujaba el mapa fuera de la vista**: había
que subir para volver a verlo, justo mientras uno lee el log buscando en qué paso se rompió. La parte
que siempre se olvida de este patrón es el `min-height:0` en el hijo flex — sin él no se achica por
debajo de su contenido y el `overflow:auto` de adentro no llega a activarse nunca.

⚠⚠ **NO HAY ZOOM NI ARRASTRE: EL MAPA SE AJUSTA CAMBIANDO EL LAYOUT.** Es la decisión que más afecta
cómo se lee. Hubo dos intentos antes y los dos fallaban por lo mismo: con `scale()`, **el texto escala
con el dibujo** — a 0,65 los nombres de las etapas dejaban de leerse, que es lo único que el mapa tiene
que hacer; y ponerle un piso a la escala sólo cambiaba el problema, porque abajo del piso el dibujo se
cortaba y había que arrastrar.

Ahora la separación entre nodos (`PASO`) y entre carriles (`CARRIL`) se calculan con el espacio
disponible. El dibujo entra siempre y **el texto nunca cambia de tamaño**.

⚠ **Y el `PASO` NO tiene tope superior, a propósito: el mapa tiene que LLENAR el ancho que le queda.**
Con un máximo fijo el dibujo dejaba de crecer pasados los ~1.250 px de caja y el resto quedaba como
fondo vacío — en una pantalla de 1.900 sobraban **696 px**, y se leía como que el mapa «no se estira»
al mover el sidebar: se estiraba el panel, lo que no crecía era el dibujo. Medido después del cambio:
sobran 1, 6 y 2 px en tres anchos distintos. El MÍNIMO sí se queda (74): por debajo los labels se pisan
y ahí conviene scrollear. Medido moviendo el tirador del sidebar: `PASO` fue 120 → 82 → 74 → 103 y el label se quedó en
**12px** en los cuatro. Si ni con el mínimo entra, el contenedor scrollea, que es lo honesto.

⚠ **Y las dos realimentaciones que este patrón invita, las dos evitadas a propósito:** el SVG mide lo
que mide el DIBUJO (no la caja, o el div crece y el observer entra en bucle — llegó a 17.601 px), y el
contenedor lleva `scrollbar-gutter: stable`, porque de su `clientWidth` sale el `PASO`: sin el gutter,
al aparecer la barra el ancho baja, el dibujo entra, la barra se va y el mapa oscila. **Lo que se MIDE
del contenedor no puede depender de lo que se DIBUJA adentro.**

⚠⚠ **Y EL ESTADO SE PINTA SÓLO EN EL CARRIL QUE SE RECORRIÓ.** El `status` y el `detail` de una etapa
salen de ESTA traza, que fue por UN ramal: pintarlos en los otros afirma sobre un camino que no ocurrió.
Se vio corriéndolo — `biometria` aparecía en el carril `creditopx` con «no aplica a ramal redirect», que
en creditopx es falso. Los carriles inactivos muestran la FORMA y nada más: son contexto, no
diagnóstico.

Tres reglas si lo tocás, y las tres salieron de correrlo contra trazas reales:

- **Se atenúa lo que NO EXISTE, nunca lo que está VACÍO** — la misma regla de la lista. Una etapa sin
  evidencia es justo donde el flujo se pudo cortar; despintarla hace una herramienta que nunca muestra el
  problema. Las `no-aplica` van en ∅ y grises: «no pasó por ahí» y «ahí no se pasa nunca» son diagnósticos
  opuestos.
- **El halo de ruptura va ROTULADO.** La vista abre sola la etapa que rompió (`indiceInteresante`), así
  que el halo cae encima del borde de selección y los dos se leen como uno solo. «se cortó acá» no se
  confunde con «esto es lo que estás mirando».
- **El salto de tiempo no es proporcional.** Va por logaritmo con tope: una solicitud retomada al día
  siguiente tiene un salto de 900 minutos y con escala lineal el mapa mide diez pantallas de alto. Así la
  diferencia entre 2 y 40 minutos se ve —que es la que importa— y la de 40 a 900 se satura.

⚠⚠ **Y el bug que costó buscar en el lugar equivocado: el alto del canvas no puede salir del contenido.**
El `<svg>` toma su alto de `cam.h`, que se lee del contenedor con `clientHeight`. Con el SVG como hijo en
flujo normal eso se realimenta —el SVG estira al div, el div dispara el `ResizeObserver`, `encuadrar()`
lee un alto mayor y lo escribe otra vez—: medido, el contenedor llegó a **17.601 px** creciendo 200 px
cada 300 ms. **El síntoma no es un error** —la consola queda limpia— sino que la rueda y el arrastre se
ven MUERTOS, porque el zoom sí se aplica y el re-encuadre del bucle lo pisa en el mismo tick. Los dos
candados están puestos (alto atado a la ventana, SVG en `position:absolute`) y la regla general vale para
cualquier canvas: **el que LEE su tamaño del padre no puede ESCRIBIRLO en un hijo en flujo.**

## Cómo se sabe que el mapa sigue siendo cierto (dos chequeos, y no son lo mismo)

El peor modo de falla de esta herramienta **no es que se caiga**: es que el mapa deje de describir el
sistema y el diagnóstico salga igual de prolijo, pero equivocado. Contra eso hay dos redes, y la
diferencia entre ellas es **qué necesitan para correr**:

| | qué mira | qué pide | cuándo |
|---|---|---|---|
| `make trazador-chequeo` | coherencia interna, el vocabulario de ramales que comparte con el harness, y —con `TARGET`— que las tablas declaradas existan | **nada** | siempre que se toque el mapa |
| `make trazador-validar CORPUS=…` | solapes entre patrones, matchers mudos, cobertura por etapa | un corpus de líneas reales | al tocar los `matchers` |

⚠ **El segundo existe desde antes y casi no se corre, justamente porque pide un corpus.** Esa es la
razón de ser del primero: hay una clase entera de mentiras del mapa que no necesita líneas para
detectarse. La idea no es original — es `bin/steps-check.ts` del harness, cuya nota lo dice mejor que
cualquier resumen: *«el mapa dice "este paso toca N archivos"; ese número sólo vale si los archivos
existen de verdad. Si alguien mueve o renombra uno, el panel seguiría mostrando el conteo viejo —dato
con cara de verdad— y nadie se enteraría.»* Acá el equivalente son **las tablas** que cada etapa declara
como su evidencia y **los ids de ramal**.

Tres cosas que hay que respetar si lo tocás:

- **El chequeo NO abre la fuente por defecto.** El default de `-target` es `prod`, así que un `-chequeo`
  pelado salía a consultar PRODUCCIÓN para leer el `information_schema` — lectura inocua, pero sigue
  siendo prod, y el esquema es el mismo en cualquier ambiente. Se mira sólo si el target se pidió a
  mano (`flag.Visit` distingue eso del valor por omisión).
- **Lo que no se pudo comprobar se DICE.** Sin target, las tablas quedan «SIN comprobar» en la salida en
  vez de omitirse: un chequeo que calla lo que no miró es el falso verde que esta herramienta existe
  para no dar.
- **El chequeo viaja con `/api/mapa`, y la pantalla avisa SÓLO lo grave.** Un comando que hay que
  acordarse de correr termina como `-validar`. Los avisos (▲) —por ejemplo que `credifamilia` sea
  *ramal* acá y *extensión* en el harness— quedan para la consola: un cartel permanente deja de leerse
  y tapa a los que sí importan. Misma regla que el panel del harness.

## Los matchers contra el código, y los tres desajustes que hay que conocer

`make trazador-chequeo` cruza cada patrón del mapa con **`trazador/logs.json`**, el índice de los mensajes
que el código EMITE. Es el movimiento de `npm run contrato:bancolombia` del harness: contrastar lo que
declaramos contra la fuente real, no contra otra copia nuestra. Y a diferencia de `-validar`, el corpus
está siempre en el repo, así que un patrón que no captura nada **no es ambiguo**: es un mensaje que nadie
escribe.

⚠ **Pero el índice y el mapa hablan idiomas distintos, y las tres diferencias dan falsos positivos.** Las
tres están resueltas en `matchersAgainstCode`; si la tocás, no las deshagas:

1. **El índice guarda el literal NORMALIZADO** (`_normalizar` colapsa espacios y corta ` :.-,` del final)
   y el matcher está escrito contra el mensaje de RUNTIME. «No risk central data found**.**» y «No risk
   central data found» no coinciden en ningún sentido ingenuo: la comparación va en **las dos
   direcciones**.
2. **El literal es un PREFIJO del runtime** (el resto son valores interpolados), nunca al revés.
3. **Hay patrones que este corpus no puede juzgar**, y meterlos con los mudos daba **ocho acusaciones
   falsas de quince**: los que miran un `campo` del context, y los que buscan un IDENTIFICADOR del código
   (`ValidateOtpAuthService`). El mensaje de runtime sí los lleva —se ven en cualquier traza— pero el
   literal no, porque la clase y el método se componen en ejecución. Se reconocen porque **no tienen
   espacios**: un mensaje de log los tiene; un identificador, no.

**Lo que encontró la primera corrida, y ya está arreglado:** cinco matchers anclados al NÚMERO de un
stage del pipeline de Experian. Medido contra `origin/main` el 2026-09-18, el código los renumeró
—«Frequency review» pasó de 2 a 4, «Check flow omitions» de 3 a 2, «Bypass rules review» de 4 a 3— y los
cinco quedaron mudos **sin que nada avisara**: un matcher que no captura no falla, sus líneas caen en «sin
ubicar» y la etapa se dibuja más vacía de lo que fue. Ahora van por REGEX CON EL NOMBRE
(`^STAGE \d+ — Frequency review`), que sobrevive a cualquier renumeración y además no se come los STAGE
0-2 de `FlowSignatureService`, que son otro pipeline. `TestNoMatcherAnchorsToAStageNumber` lo fija.
También se acortó «Persisting fetched report», cuyo mensaje se extendió, y se borraron dos patrones que
**ningún repo indexado emite** — buscados en los diez de `ROOTS`, no en uno.

⚠⚠ **Y la vara misma envejece: `logs.json` está gitignoreado y se DERIVA de los repos.** El que había
el 18/9 tenía un mes (1.576 mensajes); regenerado dio **1.978**. Antes de creerle a una acusación del
chequeo, mirá la fecha del archivo y reconstruilo con `make trazador-indexar-logs`, que actualiza las
refs remotas antes de recorrer — indexar el `main` LOCAL de cada clon, que nadie actualiza, describía un
código de días atrás (estaba 14 commits detrás). Hasta el 2026-09-24 lo construía Python, en `workers/`;
se portó a Go (`log_index.go`) comparando el JSON byte a byte.
Esto no es sólo del chequeo: **`trace_files.go` usa ese mismo índice en cada traza** para decir qué código
dejó rastro.

## Las pruebas: la lógica que ya dio un diagnóstico equivocado

`go test ./server/...`. El criterio de qué se cubre es el de las diez specs de `pkg/` del harness —las
que no tocan browser ni BD—: **no cobertura por cobertura, sino la lógica cuyo error no rompe nada y
sale prolijo.**

- `environmentSelector` y `splitByBackend` — el filtro de Loki y el aviso de qué backend sirvió cada
  línea. Existen porque un filtro que no matchea sale como «sin líneas de log» con los logs ahí: hasta el
  2026-09-23 el de dev comparaba `development|develop` entero y no se aplicaba nunca. Y aparte, que las
  tres listas de ambientes (server, store, selector) sean las mismas: agregar `qa` pedía tocar las tres.
- `outcomeOf` — existe porque HABÍA DOS definiciones y no coincidían (una contemplaba el estado 7
  «abandonado» y la otra no, así que la misma solicitud salía «en curso» en la lista y «abandonado» al
  abrirla). La prueba fija los cuatro desenlaces y, aparte, que **ningún estado esté en `sellados` y en
  `malos` a la vez**: ahí gana el orden del `switch` y una solicitud negada saldría verde.
- `laneOfRT` — cada ramal que el código devuelve tiene que estar declarado en `ramales.json`. Si no, sus
  etapas quedan sin clasificar y se dibujan como «podía pasar y no pasó» cuando ahí no se pasa nunca.
- `classifyReports` — el barrido de #tech-ops contaba los reportes que ninguna regex reconoce y los
  **tiraba**, así que el veredicto («el trazador contesta el X %») se calculaba sobre los clasificados:
  hablaba de las regex creyendo hablar del canal, y con la mitad sin reconocer habría dicho 100 %. La
  prueba fija que un reporte sin categoría vuelva **con su texto** —contarlo no alcanza, hay que poder
  mirarlo— y que entre al denominador. ⚠ Un reporte que ninguna regex reconoce **no es «fuera de
  alcance»**: eso es un juicio. Es NO SE SABE, y es la única casilla que dice si conviene mejorar esto.
- Y queda escrito que **Credifamilia se decide por `id == 24`**, o sea por IDENTIDAD y no por
  configuración: deuda conocida (un id quemado en el código), que miente en silencio
  el día que ese lender cambie de id. La prueba no la arregla; la deja a la vista para que el cambio sea
  deliberado.

⚠ **Y las pruebas se comprueban mutando el código, no mirando el verde.** `go test` imprime `ok` igual
para un test que pasa que para uno que se salta. Al agregar una, rompé a propósito lo que dice proteger
y mirá que falle con el mensaje que esperabas.
