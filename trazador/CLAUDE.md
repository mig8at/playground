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

⚠ **El mapa NO es una copia del mapa del harness, y copiarlo hubiera sido el error.** Aquél dibuja las 26
**pantallas** que un comercio PUEDE recorrer; éste, las 9 **etapas de negocio** que UNA solicitud recorrió
de verdad. Lo único compartido, a propósito, es el vocabulario de ramales (`creditopx` · `agregador` ·
`redirect`), que ya estaba compartido en `ramales.json`.

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
