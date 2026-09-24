# trazador — protocolo (lo que sólo sabe el ambiente donde ya pasó)

**El manual es [`README.md`](README.md)**: los modos, el mapa de 39 pasos, las tres fuentes, la
configuración por stack y las trampas de Grafana. Acá va lo otro, que nadie había escrito: **cuándo se
usa, cuándo NO, y dónde va a parar lo que devuelve.**

## Qué contesta esto que ninguna otra herramienta contesta

Las tres se reparten preguntas distintas, y confundirlas cuesta una tarde:

- **canon** describe el **mecanismo**, y por eso generaliza — pero no sabe nada de tu caso.
- `harness/` **corre un caso que vos sembrás**: contesta *¿qué pasaría si el cliente es así?*
- **el trazador mira lo que YA pasó, en el ambiente donde pasó** — y es el único que llega a `prod`.

De ahí salen sus tres preguntas, y ninguna se puede contestar leyendo:

| la pregunta | el modo |
|---|---|
| ¿qué le pasó a **esta** solicitud, y dónde se rompió? | `make trazador-ureq UREQ=… TARGET=…` |
| ¿esto pasa **de verdad**, y **cuánto**? | `make trazador-sql TARGET=prod SQL='SELECT …'` |
| ¿qué **vio** el cliente en la pantalla? | `make trazador-posthog UREQ=… TEL=…` |

⚠ **Y la segunda es la que más rinde y la que menos se usa.** «Esto seguro pasa poco» es una hipótesis,
no un dato, y el costo de equivocarse es construir para un caso que no existe — o descartar uno que sí.
Antes de escribir un número sobre el comportamiento del sistema, medilo: la herramienta ya está cableada
y una `SELECT` contra prod tarda segundos.

## El recorrido se ve en UNA vista: el mapa

*(Acá hubo un tiempo dos —`lista` y `mapa`, con un toggle— y esta sección decía que convivían «hasta
saber cuál se usa». Se supo: Miguel miró el mapa con carriles y pidió quedarse sólo con él. La lista
(`Etapas.vue`) se borró el 2026-09-18; git la guarda.)*

⚠ **Al borrarla hubo que traerse lo único que hacía y el mapa no: el recorrido por TECLADO.** Un
`<g @click>` de SVG no recibe foco ni se anuncia a un lector de pantalla, así que cada nodo lleva
`tabindex`, rol de botón y ←/→ para moverse por el orden del flujo. Sin eso, cambiar de vista habría
sido dejar la herramienta sin más forma de navegarla que el mouse.

⚠ **EL CONTENIDO NO ES EL DEL HARNESS; LA FORMA SÍ, Y ESO FUE LO CORRECTO.** Aquél dibuja las 26
**pantallas** que un comercio PUEDE recorrer; éste, las 9 **etapas de negocio** que UNA solicitud
recorrió. Pero el layout —tronco horizontal que se abre en un carril por ramal— se copió del suyo, y la
primera versión de este mapa (una sola columna vertical) estaba peor justamente por no hacerlo: mencionaba
el carril en un pie de página en vez de dibujarlo, o sea perdía la única dimensión que el trazador sabe y
la lista no puede mostrar. *(Acá decía «copiarlo hubiera sido el error». Era confundir el contenido con el
estilo: son cosas distintas y sólo una de las dos no se comparte.)*

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

## Cuándo NO es esto

- **«¿cómo funciona X?»** → **canon**. El trazador te muestra UNA corrida; una corrida no es el
  mecanismo, y leer el mecanismo desde un caso es exactamente cómo se sacan conclusiones falsas.
- **«¿qué pasaría si…?»** → `harness/`. El trazador **no puede** contestarlo: sólo ve lo que ocurrió.
- **«¿por qué existe esta regla?»** → `make confluence`. El porqué del negocio no está en los datos.
- **«¿puedo leer los logs?»** → ésa es `trazador-acceso`, la sonda, y **no es la forense**. Confundirlas
  es fácil porque comparten prefijo.

## El límite, y no se negocia

**No escribe en ningún ambiente.** Sólo `SELECT` y `GET`, en los cinco targets. El `-sql` tiene guarda,
pero ⚠ **la guarda no era lo que lo garantizaba** — lo garantizaba el motor, y `INTO OUTFILE` pasaba
(**F-109**). Si vas a tocar ese modo, leé el hallazgo antes.

Y **`prod` es SOLO LECTURA, siempre**, lo cual acá no es una restricción incómoda: es el único ambiente
donde la pregunta «¿cuánto?» tiene respuesta verdadera.

## Dos trampas que ya costaron una medición

- ⚠ **Los defaults son OPUESTOS a los de su vecino**: `trazador-ureq` arranca en `prod` y
  `harness-loki` en `local`. Cambiar de herramienta sin escribir `TARGET=` te cambia de ambiente sin
  avisar (familia de **F-234**). Por eso cada salida imprime su comando **con el target adentro** —
  pegá ese, no lo reescribas de memoria.
- ⚠ **`trazador-acceso` te muestra una MUESTRA, no un conteo.** Con `-limit 200` trae 200 líneas e
  imprime cuatro, y las cuatro se ven idénticas a doscientas. Contarlas así dio «46 % de los errores son
  del profiler» cuando el número real era **9,2 %**. Para contar, la expresión métrica:
  `QUERY='sum(count_over_time({service_name="x", level="error"} [24h]))'`.

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

### Los matchers contra el código, y los tres desajustes que hay que conocer

`make trazador-chequeo` cruza cada patrón del mapa con **`trazador/logs.json`**, el índice de los mensajes
que el código EMITE. Es el movimiento de `npm run contrato:bancolombia` del harness: contrastar lo que
declaramos contra la fuente real, no contra otra copia nuestra. Y a diferencia de `-validar`, el corpus
está siempre en el repo, así que un patrón que no captura nada **no es ambiguo**: es un mensaje que nadie
escribe.

⚠ **Pero el índice y el mapa hablan idiomas distintos, y las tres diferencias dan falsos positivos.** Las
tres están resueltas en `matchersContraElCodigo`; si la tocás, no las deshagas:

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
0-2 de `FlowSignatureService`, que son otro pipeline. `TestNingunMatcherSeAnclaAlNumeroDeUnStage` lo fija.
También se acortó «Persisting fetched report», cuyo mensaje se extendió, y se borraron dos patrones que
**ningún repo indexado emite** — buscados en los diez de `ROOTS`, no en uno.

⚠⚠ **Y la vara misma envejece: `logs.json` está gitignoreado y se DERIVA de los repos.** El que había
el 18/9 tenía un mes (1.576 mensajes); regenerado dio **1.978**. Antes de creerle a una acusación del
chequeo, mirá la fecha del archivo y reconstruilo con `make trazador-indexar-logs`, que actualiza las
refs remotas antes de recorrer — indexar el `main` LOCAL de cada clon, que nadie actualiza, describía un
código de días atrás (estaba 14 commits detrás). Hasta el 2026-09-24 lo construía Python, en `workers/`;
se portó a Go (`indice_logs.go`) comparando el JSON byte a byte.
Esto no es sólo del chequeo: **`archivos.go` usa ese mismo índice en cada traza** para decir qué código
dejó rastro.

## Las pruebas: la lógica que ya dio un diagnóstico equivocado

`go test ./server/...`. El criterio de qué se cubre es el de las diez specs de `pkg/` del harness —las
que no tocan browser ni BD—: **no cobertura por cobertura, sino la lógica cuyo error no rompe nada y
sale prolijo.**

- `selectorAmbiente` y `repartoPorBackend` — el filtro de Loki y el aviso de qué backend sirvió cada
  línea. Existen porque un filtro que no matchea sale como «sin líneas de log» con los logs ahí: hasta el
  2026-09-23 el de dev comparaba `development|develop` entero y no se aplicaba nunca. Y aparte, que las
  tres listas de ambientes (server, store, selector) sean las mismas: agregar `qa` pedía tocar las tres.
- `desenlaceDe` — existe porque HABÍA DOS definiciones y no coincidían (una contemplaba el estado 7
  «abandonado» y la otra no, así que la misma solicitud salía «en curso» en la lista y «abandonado» al
  abrirla). La prueba fija los cuatro desenlaces y, aparte, que **ningún estado esté en `sellados` y en
  `malos` a la vez**: ahí gana el orden del `switch` y una solicitud negada saldría verde.
- `ramalDeRT` — cada ramal que el código devuelve tiene que estar declarado en `ramales.json`. Si no, sus
  etapas quedan sin clasificar y se dibujan como «podía pasar y no pasó» cuando ahí no se pasa nunca.
- `clasificarReportes` — el barrido de #tech-ops contaba los reportes que ninguna regex reconoce y los
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

## Qué deja esto en la tarea

Lo que el trazador devuelve **no se resume a mano**. Con `BLOQUE=<id|slug>` (`trazador-ureq` ·
`trazador-buscar` · `trazador-sql`) se agrega solo, como bloque, a la pila de esa tarea: el título con el
resumen, el comando exacto en su caja y lo que dio, con `via: trazador`. Entra por `make tarea-bloque`,
así que lo valida el tablero y no una copia de sus reglas.

    make trazador-sql TARGET=prod SQL='SELECT …' BLOQUE=<tarea>

Lo que mediste va a la pila como ese bloque —un hecho que sostiene una decisión o descarta un camino es
un bloque—, y la RECETA para volver a comprobarlo, si hace falta mantenerla, va a **«Cómo se comprueba —
y el MATERIAL»** del documento ([`tablero/CLAUDE.md`](../tablero/CLAUDE.md)).

Y con `MD=1` sigue saliendo ya escrito como anotación, con la fecha real del día, la evidencia y el
comando que la reproduce adentro, para un documento que NO es una tarea —un `CLAUDE.md`, una trampa—:

    make trazador-sql TARGET=prod MD=1 SQL='SELECT …'

*(Hasta el 2026-09-23 esa anotación se pegaba en el `.md` de la tarea, en «Lo que está decidido» o en
«Cómo se comprueba». Ese día la historia de las tareas pasó a la pila, y el lint del tablero frena una
anotación nueva en una tarea.)*

**Por qué se pega con el comando y no sólo con la conclusión:** una medición sin su comando envejece sin
avisar — nadie sabe cómo volver a tomarla, así que nadie la desmiente. Con el comando adentro, mañana se
vuelve a correr y **se puede demostrar que dejó de ser cierta**, que es lo único que distingue una
medición de una creencia con números.

Y no es sólo una convención de lectura: **el validador de la pila lo exige**. Un bloque con una corrida
la lleva en su caja ` ```trazador ` —o ` ```sql prod `—, con el ambiente en su `TARGET=`, y debajo su
`Resultado:`. El ambiente sale **sólo** de ahí, nunca de la prosa, porque «en producción son 14.160»
menciona un ambiente sin decir dónde se midió. Cuando se escribía a mano, lo que quedaba debajo era
prosa en vez del comando en el 86 % de los casos (medido el 2026-09-18 sobre las anotaciones de
entonces: 350, 308 con continuación, **51** con una fuente reconocible).

Y el tipo de anotación es siempre `MEDICIÓN`, a propósito: eso sale de correr algo. Una `DECISIÓN` o un
`RIESGO` los escribe una persona.

⚠ **Si el hecho medido resultó ser del SISTEMA y no de la tarea** —una trampa reproducible, con causa
raíz— no se queda acá: gradúa a `tablero/data/traps/doc.md`. El test de siempre: *si
esto se mergea mañana, ¿sigue siendo cierto?*

## Y lo que NO sale de acá a Jira

La medición sí; **la herramienta no**. `## Tarea (publicable)` cambia de idioma: va *«se consultó
producción: el 12 % de las solicitudes…»*, nunca el `make trazador-sql`. No es cosmética — nadie más del
equipo tiene esta herramienta, así que nombrarla manda al lector a algo que no puede correr y hace
parecer que el dato depende de un juguete personal. El guard del tablero ya frena la palabra
`trazador` (`connectors/guard/guard.go`) y el motivo dice con qué reemplazarla; la regla
entera está en [`tablero/CLAUDE.md`](../tablero/CLAUDE.md), en «La frontera del guard está DENTRO del
archivo».

## Cómo está modelado el recorrido (venía del árbol de contexto)

El contexto curado describe **CreditOp**, y esto describe **esta herramienta**: cómo está modelado su recorrido y qué no se puede afirmar con él. Vivía en un nodo del árbol de `context/` —donde su vigencia se medía contra `main` como si fuera código del producto, que es una vara que acá no aplica: este código y este archivo se commitean juntos—. Se movió tal cual el 2026-09-21, poco antes de que ese árbol se apagara del todo.

### Antes de concluir


- **Un estado dice DÓNDE está la solicitud, nunca QUÉ completó.** Es la trampa que ya costó tres veces:
  el estado 10 pertenece a `disbursement` pero significa «adentro, sin firmar» (F-103); la fila de
  estado 9 **se escribe al CREAR la solicitud**, no al completar el formulario (F-106); y
  `user_request_records` **no registra todas las transiciones** — los estados 1 y 10 nunca dejan fila
  (F-105). Por eso `cierran` y `detienen` están separados en el mapa.
- **El wizard NO manda logs a Loki**: sus logs de ruta salen por OTLP hacia PostHog. Verificado el
  2026-08-07 buscando `service_name` que matchee wizard/front/loan-request/remix/react: cero líneas. O
  sea que **la pantalla se INFIERE del endpoint que el backend sirvió**, y una pantalla que no llama al
  backend es invisible. Eso no se arregla con el mapa: es la frontera de lo que la herramienta puede
  afirmar.
- **Dos de las tablas de evidencia ya se leen** (desde el 2026-08-07): `users_category_log` —la etapa
  `profiler` salía *siempre* «la BD no registra esta etapa», y sí la registra— y `deceval_logs`, que era
  la única de las 14 de auditoría con atribución del 100 % (F-108). Las otras 13 siguen sin leerse, y
  dos de ellas (`compare_face_logs`, `ocr_logs`) **declaran `user_request_id` y nunca lo escriben**:
  usarlas devolvería vacío siempre.
- **Hay evidencia en la BD que este trazador NO mira**: 14 tablas de log de auditoría. Medido: sólo
  `deceval_logs` ata al **100 %** por `user_request_id` y es candidata limpia para el tramo del pagaré;
  `otp_logs` sólo al **1,25 %**; y `compare_face_logs` / `ocr_logs` **declaran la columna y nunca la
  escriben**. ⚠ **Re-medido el 2026-09-19 y las cuatro se sostienen, con los volúmenes crecidos**:
  `deceval_logs` **5.473 filas sobre 597 solicitudes**, todas atadas (eran 1.404 / 174) · `otp_logs`
  **13.604 de 1.084.837** · `compare_face_logs` **0 de 8.582** · `ocr_logs` **0 de 10.667** — usarlas por solicitud
  devolvería vacío siempre y se leería como «no pasó». Ver **F-108**.
- **Las funciones SQL no loguean.** 42 rutinas de MySQL calculan cosas del negocio (el ingreso, la
  ocupación, los features del ML) y no escriben una línea: este árbol puede mostrar la entrada y la
  salida de ese cómputo, nunca el medio. Nodo `db-routines`.
- **Un rechazo de cupo ROTATIVO (rt=3) es invisible para esta herramienta, y no es culpa del mapa.** El
  corte `multiplier <= 3` retorna antes de escribir nada: sin log, sin fila en `revolving_credits` y sin
  transición de estado. Las tres fuentes que cruza el trazador quedan vacías a la vez, así que la etapa
  sale `sin-evidencia` — que es lo correcto, pero deja la pregunta «¿por qué 0?» sin contestar. Se
  arregla en el producto (persistir el JSON del multiplicador), no acá. Ver **F-115** y el nodo
  `rotativo`.
- **`risk_central_user_data` se cruza por `user_id`, no por solicitud**: un cliente con varias
  solicitudes en la misma ventana contamina la traza abierta. El árbol lo avisa en los warnings, pero
  las filas igual cuentan en los totales.
- **Sólo ~13 % de las líneas de log dice a qué solicitud pertenece, y lo dice con tres nombres
  distintos** (`context_user_request_id`, `context_userRequestId`, `context_request_id`) — F-102. El
  resto se ubica por herencia de span, y eso se declara en el pie de la traza.
- **`LOKI_ENV` no es el mismo valor en los dos stacks**: prod es `production`; el stack de dev/qa usa
  `development|local|testing` y **no tiene el valor `qa`**. Filtrar por `environment=qa` devuelve cero
  líneas mientras los logs existen.
- **Dev y qa se separan por `service_name`, no por `environment`** (los dos PHP son `development`).
  Medido el 2026-09-23 pegándole a cada backend: dev → `legacy-backend`, qa → `CreditopDev`; staging no
  se pudo ubicar. Cada `connectors/.env.<target>` lo declara en `LOKI_SERVICE`, y ⚠ **no filtra: avisa.** Una
  solicitud pasa por los dos backends (la 502633, de qa: 442 líneas de qa y 159 de dev), así que filtrar
  escondía parte de lo que le pasó; la traza cierra con el reparto por backend (`repartoPorBackend`).
  Lo pone un secreto del despliegue, no el repo: puede cambiar sin commit. El detalle y cómo re-medirlo:
  README §«El ambiente es el STACK».
- **Los mapas van embebidos** (`go:embed mapa/*.json`): editar un JSON y no reiniciar el server deja la
  UI mostrando el mapa viejo. Es la confusión más frecuente al iterar.

**(2026-09-19) Re-verificado entero, cuando esto era un nodo del árbol.** 15 afirmaciones auditadas —9 contra el código del trazador
y 6 de dato re-medidas contra producción—, cero chequeos débiles y **ninguna falsa**. Era el nodo que
mejor resistió de los veintidós: la estructura del mapa está exacta —`go:embed mapa/*.json` en
`server/mapa.go:30`, los tres JSON, las nueve etapas en su orden, y `bd.estados` / `bd.cierran` /
`bd.detienen` en las cuatro etapas que los tienen—, y **las cuatro mediciones de atribución se
sostuvieron todas**: `deceval_logs` sigue al 100 %, las dos mudas siguen en cero. Lo único agregado es
la distinción `id` contra `label`, que me hizo tropezar al verificarlo. ⚠ Un conteo para mirar cuando
se retome F-108: hoy hay **19 tablas** cuyo nombre termina en `_log`/`_logs` (10 en plural, 9 en
singular); esta herramienta trabaja sobre un subconjunto de 14.

### Contenido


**Las 9 etapas** (el orden es de FLUJO, no de hora) usan el vocabulario del wizard, porque el reporte de
soporte llega en ese idioma («falló en firma de documentos», no «falló en formalization»):

⚠ **Y cuidado al buscarlas en el JSON: los nueve nombres de abajo son el `label`, no el `id`.** En `mapa/etapas.json` cada etapa tiene un `id` en castellano —`origen`, `registro`, `formulario`, `cupo`, `listado`, `seleccion`, `respuesta-lender`, `biometria`, `desembolso`— y el `label` es el vocabulario del wizard. Grepear el mapa por `amount` encuentra un label; el id de esa etapa es `origen`. (El `orden` tampoco es 1-9: va de 10 en 10, con `75`/`78` intercalados.)

`amount` → `authorization` → `personal-info` (incluye burós) → `profiler` → `lenders` →
`selected lender` → `lender response` → `validation` → `disbursement`

**Dos mapas declarativos**, embebidos con `go:embed` (por eso **un cambio de mapa exige recompilar**):

- `mapa/etapas.json` — a qué ETAPA va cada línea de log (matchers por prefijo/exacto/regex), y la
  semántica de los estados de BD: `bd.estados` (pertenencia) · `bd.cierran` (prueban que TERMINÓ) ·
  `bd.detienen` (la solicitud está adentro y no salió). Esas tres son preguntas distintas y mezclarlas
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

**Y DOS CHEQUEOS DEL MAPA, que no son lo mismo: la diferencia es qué necesitan para correr.**

| | qué mira | qué pide |
|---|---|---|
| `-chequeo` | coherencia interna, los ids de ramal que comparte con `harness/panel/steps.json`, los matchers contra los mensajes que el código EMITE y —con `-target`— que las tablas declaradas existan | **nada** |
| `-validar <corpus>` | solapes entre patrones, matchers mudos, cobertura por etapa | un corpus de líneas reales |

⚠ **El segundo existe desde antes y casi no se corre, justamente porque pide un corpus.** Ésa es la
razón del primero: hay una clase entera de mentiras del mapa que no necesita líneas para detectarse.

**Lo que encontró su primera corrida (2026-09-18) vale como advertencia del tipo de deriva que acumula
este mapa:** cinco matchers anclados al NÚMERO de un stage del pipeline de Experian, que el código
renumeró —«Frequency review» pasó de 2 a 4, «Check flow omitions» de 3 a 2, «Bypass rules review» de 4
a 3—. Los cinco quedaron **mudos sin que nada avisara**: un matcher que no captura no falla, sus líneas
caen en «sin ubicar» y la etapa se dibuja más vacía de lo que fue. Ahora van por regex con el NOMBRE.
El número es el orden del pipeline y se renumera; el nombre es lo estable.

⚠ **El cruce contra el código usa `trazador/logs.json`, que es un índice DERIVADO y puede estar viejo.**
Se construye con `make trazador-indexar-logs`; el que había el 2026-09-18 tenía un mes
(1.576 mensajes) y regenerado dio 1.984. Antes de creerle a una acusación del chequeo, mirá su fecha.

**El `Ramal` de la traza** (`creditopx` · `agregador` · `redirect` · `credifamilia`) sale del
`response_type` del lender ya sellado en la solicitud, así que **sólo existe después de que el cliente
eligió**: antes de `selected lender` no hay ramal, y eso es un hecho, no un dato faltante. De él cuelga
qué etapas se declaran `no aplica`.

⚠ Y se decide por **identidad** en un caso: Credifamilia por `id == 24`, no por su `response_type`. Es
deuda conocida —un id quemado en el código— y miente en silencio el día que ese
lender cambie de id.

**La evidencia va con el paso.** Cada sub-paso de BD lleva un bloque `Evidencia` con la consulta que
corrió (con el `?` ya resuelto, para pegar en Redash) y las filas que produjeron ese renglón. Se
renderiza aparte de los logs a propósito: una fila de BD es un ESTADO, no un evento — pintarla como log
invita a armar una línea de tiempo con lo que no es una.

**EL RECORRIDO SE VE EN UNA SOLA VISTA: EL MAPA (2026-09-18).** Hubo dos —una lista de etapas al
estilo de un run de CI y el mapa— y la lista se borró: el mapa contesta lo mismo y además «¿por dónde
fue, dónde se cortó y cuánto faltaba?», que una lista no puede. Lo único que hubo que traerse de ella
es el recorrido por TECLADO (←/→ y foco), porque un `<g @click>` de SVG es invisible para el teclado y
para un lector de pantalla.

⚠ **El CONTENIDO del mapa no es el del harness, pero la FORMA sí**: aquél dibuja las 26 **pantallas**
que un comercio PUEDE recorrer y éste las 9 **etapas de negocio** que UNA solicitud recorrió, y sin
embargo el layout —tronco horizontal que se abre en un carril por ramal, nodo hueco si es condicional,
carril que no aplica atenuado en vez de ausente— se tomó del suyo. La diferencia que sí obligó a
cambiar algo: **el color ya estaba ocupado**. Allá dice qué carril; acá tiene que decir cómo salió, así
que la arista lleva el carril y el nodo el estado. Y el estado se pinta **sólo en el carril recorrido**:
el `status` de una etapa sale de ESTA traza, que fue por un ramal, y mostrarlo en los otros afirma sobre
un camino que no ocurrió. El vocabulario de ramales ya estaba compartido en `ramales.json` — y desde el
2026-09-18 el `-chequeo` lo verifica en vez de suponerlo.

**La corrida entra sola a una tarea:** `BLOQUE=<id|slug>` en `-ureq`, `-buscar` y `-sql` la agrega como
bloque a su pila, con el comando y lo que dio; `MD=1` emite la anotación, para un documento que no es
una tarea. El tipo es siempre `MEDICIÓN`: eso sale de correr algo, y una `DECISIÓN` la escribe una
persona.

**(2026-08-28)** Deriva = commits propios de este playground (el árbol de 39 pasos «DÓNDE QUEDÓ» dentro
de la traza, y las etapas nuevas). El doc describe la herramienta; su evolución es autodocumentada en
los commits.

### Fronteras (qué NO contesta esta herramienta, y quién sí)


- **Qué significa cada tabla/columna** del dominio → `profiling`, `entities`, `actors`.
- **Con qué string se busca cada decisión de negocio en los logs** → el nodo dueño de esa decisión, que
  documenta sus marcadores con archivo y línea: categoría rt=2 (`CATEGORY_*`, incluido el
  `CATEGORY_RULE_REJECTED` que trae `failed_criteria`) → `profiling` · cupo (`QUOTA_CHECK_REJECTED`) →
  `creditopx` · rotativo (`REVOLVING_CREDIT_*`) → `rotativo` · compuertas de buró (`STAGE 0…4`) → `kyc`.
  ⚠ **Las etiquetas en español que muestra el trazador NO son los strings del log** («Regla de categoría
  rechazada» ≠ `CATEGORY_RULE_REJECTED`): buscar en Loki por la etiqueta no devuelve nada.
- **Por qué el sistema se comporta así** (reglas, ramales, integraciones) → los nodos de flujo.
- **Los hallazgos** que el trazador ayudó a encontrar viven en las trampas del sistema (F-100…F-106), no acá.
- **Ejercitar/mockear un flujo** es `harness`. El trazador LEE lo que ya pasó; el harness lo PROVOCA.

### Lo que NO está verificado

- `-validar` no corre desde el 2026-08-06: el corpus de líneas crudas se perdió con un scratchpad; regenerarlo implica decidir si líneas de producción entran al repo.
- Los 12 matchers `soloEnCodigo` del tramo identity (OCR/Rekognition/ADO) no fueron alcanzados por ninguna traza medida.
