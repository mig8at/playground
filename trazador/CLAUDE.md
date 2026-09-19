# trazador — protocolo (lo que sólo sabe el ambiente donde ya pasó)

**El manual es [`README.md`](README.md)**: los modos, el mapa de 39 pasos, las tres fuentes, la
configuración por stack y las trampas de Grafana. Acá va lo otro, que nadie había escrito: **cuándo se
usa, cuándo NO, y dónde va a parar lo que devuelve.**

## Qué contesta esto que ninguna otra herramienta contesta

Las cuatro se reparten preguntas distintas, y confundirlas cuesta una tarde:

- `context/` describe el **mecanismo**, y por eso generaliza — pero no sabe nada de tu caso.
- `workers/` describe el **código**, incluido el que nadie documentó — pero tampoco lo ejecuta.
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

## Dos vistas del mismo recorrido, y las dos se quedan

`lista` (`Etapas.vue`) y `mapa` (`Mapa.vue`) contestan preguntas distintas, y por eso conviven en vez de
reemplazarse. La lista es mejor para **«¿qué pasó en cada etapa?»** —hora, salto, sub-pasos, eventos—; el
mapa es el único que contesta **«¿por dónde fue, dónde se cortó y cuánto faltaba?»**. Si con el tiempo una
gana, la otra se va sola; decidirlo antes de mirarlas es tirar algo que funciona.

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

⚠ **EL MAPA VA A LA IZQUIERDA Y EL DETALLE ES UN SIDEBAR DERECHO**, y el reparto no es estético: el
mapa es horizontal y lo que necesita es ANCHO; el detalle es una lista de logs y necesita ALTO. Con el
mapa como banda arriba, los logs quedaban en una tira baja donde no entra nada. Clickear un nodo abre
esa etapa en el sidebar, con sus sub-pasos y sus líneas.

⚠ **Y LAS MEDIDAS DEL DIBUJO ESTÁN ELEGIDAS PARA QUE ENTRE SIN ACHICARSE.** Con `PASO = 150` medía
1.488 px y el encuadre lo escalaba a **0,65**: entraba entero y no se leía, que es la peor de las dos
cosas. Compacto (`PASO = 112`) entra a ~0,98 en una pantalla de 1600 — se ve quieto porque no hace
falta moverlo, no porque no se pueda. Y el encuadre tiene **piso en 0,8**: más vale un mapa que no
entra y se arrastra, que uno entero e ilegible.

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

- **«¿cómo funciona X?»** → `context/`. El trazador te muestra UNA corrida; una corrida no es el
  mecanismo, y leer el mecanismo desde un caso es exactamente cómo se sacan conclusiones falsas.
- **«¿qué pasaría si…?»** → `harness/`. El trazador **no puede** contestarlo: sólo ve lo que ocurrió.
- **«¿por qué existe esta regla?»** → `make confluence`. El porqué del negocio no está en los datos.
- **«¿puedo leer los logs?»** → ésa es `trazador-acceso`, la sonda, y **no es la forense**. Confundirlas
  es fácil porque comparten prefijo.

## El límite, y no se negocia

**No escribe en ningún ambiente.** Sólo `SELECT` y `GET`, en los cuatro targets. El `-sql` tiene guarda,
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

`make trazador-chequeo` cruza cada patrón del mapa con **`workers/logs.json`**, el índice de los mensajes
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

⚠⚠ **Y la vara misma envejece: `logs.json` está gitignoreado y se construye de `main` LOCAL.** El que
había tenía un mes (17/8, 1.576 mensajes); regenerado con `python3 workers/cli.py logs --construir` dio
**1.978**. Antes de creerle a una acusación del chequeo, mirá la fecha del archivo — y ojo con que
`construir()` recorre `main` local, que puede estar detrás de `origin/main` (lo estaba por 14 commits).
Esto no es sólo del chequeo: **`archivos.go` usa ese mismo índice en cada traza** para decir qué código
dejó rastro.

## Las pruebas: la lógica que ya dio un diagnóstico equivocado

`go test ./server/...`. El criterio de qué se cubre es el de las diez specs de `pkg/` del harness —las
que no tocan browser ni BD—: **no cobertura por cobertura, sino la lógica cuyo error no rompe nada y
sale prolijo.**

- `desenlaceDe` — existe porque HABÍA DOS definiciones y no coincidían (una contemplaba el estado 7
  «abandonado» y la otra no, así que la misma solicitud salía «en curso» en la lista y «abandonado» al
  abrirla). La prueba fija los cuatro desenlaces y, aparte, que **ningún estado esté en `sellados` y en
  `malos` a la vez**: ahí gana el orden del `switch` y una solicitud negada saldría verde.
- `ramalDeRT` — cada ramal que el código devuelve tiene que estar declarado en `ramales.json`. Si no, sus
  etapas quedan sin clasificar y se dibujan como «podía pasar y no pasó» cuando ahí no se pasa nunca.
- Y queda escrito que **Credifamilia se decide por `id == 24`**, o sea por IDENTIDAD y no por
  configuración: deuda conocida (la clase que cataloga `workers/cli.py quemado`), que miente en silencio
  el día que ese lender cambie de id. La prueba no la arregla; la deja a la vista para que el cambio sea
  deliberado.

⚠ **Y las pruebas se comprueban mutando el código, no mirando el verde.** `go test` imprime `ok` igual
para un test que pasa que para uno que se salta. Al agregar una, rompé a propósito lo que dice proteger
y mirá que falle con el mensaje que esperabas.

## Qué deja esto en la tarea

Lo que el trazador devuelve **no se resume a mano**: se emite ya escrito con `MD=1`
(`trazador-ureq` · `trazador-buscar` · `trazador-sql`), con la fecha real del día, la evidencia y el
comando que la reproduce adentro.

    make trazador-sql TARGET=prod MD=1 SQL='SELECT …'

Eso produce una anotación `> **MEDICIÓN · fecha**` que va, **tal cual**, a una de dos secciones del
`.md` de la tarea ([`tablero/CLAUDE.md`](../tablero/CLAUDE.md)):

| lo que mediste | dónde va |
|---|---|
| un hecho que sostiene una decisión o descarta un camino | **«Lo que está decidido»** o **«Lo que se evaluó y NO se eligió»** |
| la receta de cómo comprobar que esto sigue siendo cierto | **«Cómo se comprueba — y el MATERIAL»** |

**Por qué se pega con el comando y no sólo con la conclusión:** una medición sin su comando envejece sin
avisar — nadie sabe cómo volver a tomarla, así que nadie la desmiente. Con el comando adentro, mañana se
vuelve a correr y **se puede demostrar que dejó de ser cierta**, que es lo único que distingue una
medición de una creencia con números.

Y no es sólo una convención de lectura: **el tablero lo parsea**. Las líneas de cita que siguen al
marcador son el `Como` de la anotación, y de ahí `store.FuentesDe` deriva *con qué* se comprobó y
*contra qué ambiente*, que es lo que la tarjeta pinta (`tablero/server/internal/store/fuentes.go`). El
ambiente sale **sólo** de un `TARGET=` escrito en el comando — nunca de la prosa, porque «en producción
son 14.160» menciona un ambiente sin decir dónde se midió. Una anotación cuya continuación es prosa
explicativa en vez del comando **queda sin fuentes**, y eso es exactamente lo que hoy pasa en el 86 %
de ellas (medido el 2026-09-18: 350 anotaciones, 308 con continuación, **51** con una fuente
reconocible).

Y el tipo de anotación es siempre `MEDICIÓN`, a propósito: eso sale de correr algo. Una `DECISIÓN` o un
`RIESGO` los escribe una persona.

⚠ **Si el hecho medido resultó ser del SISTEMA y no de la tarea** —una trampa reproducible, con causa
raíz— no se queda acá: gradúa a `context/server/data/flows/findings/doc.md`. El test de siempre: *si
esto se mergea mañana, ¿sigue siendo cierto?*

## Y lo que NO sale de acá a Jira

La medición sí; **la herramienta no**. `## Tarea (publicable)` cambia de idioma: va *«se consultó
producción: el 12 % de las solicitudes…»*, nunca el `make trazador-sql`. No es cosmética — nadie más del
equipo tiene esta herramienta, así que nombrarla manda al lector a algo que no puede correr y hace
parecer que el dato depende de un juguete personal. El guard del tablero ya frena la palabra
`trazador` (`tablero/server/internal/guard/guard.go`) y el motivo dice con qué reemplazarla; la regla
entera está en [`tablero/CLAUDE.md`](../tablero/CLAUDE.md), en «La frontera del guard está DENTRO del
archivo».
