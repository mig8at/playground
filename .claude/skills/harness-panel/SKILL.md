---
name: harness-panel
description: Tocar el panel del harness harness (:5195, panel/index.html + panel/server.ts). Usala cuando la tarea toque el mapa del recorrido del wizard (panel/steps.json), el gate de perillas por target (CAPS), el selector de comercio y sucursal, el switch de Frontend local vs desplegado y su pool de Cognito, la comprobación de BD al cerrar la corrida (dbops activity), o los internals de bin/advisor.
---

# El panel del harness

**Qué es:** una UI sobre `bin/advisor` (`npm run dev` → **:5195**). No es un segundo motor: todo lo que
hace, lo hace lanzando el mismo launcher que usás por terminal. Si algo se puede resolver en `bin/advisor`,
va ahí y el panel lo consume — duplicar la lógica en la UI es como empiezan a derivar.

**Su límite, y es una decisión:** el panel **corre flujos** (inyecta + bypass) y nada más. Validar negocio
va aparte, por consola. **No metas el modo rápido (`dev/sweep.ts`) en el panel** — ya se intentó y se
revirtió: mezclarlos confunde para qué sirve cada uno.

⚠ **No te quedes con el puerto :5195.** Si dejás una instancia tuya corriendo, el `npm run dev` de Miguel
no arranca. Ya pasó dos veces. Levantalo solo si lo vas a usar, y bajalo.

## La cáscara: cinco zonas fijas, y el contrato es el `id`

Desde el 2026-09-18 el panel tiene forma de editor y no de página: **barra de título** (ambiente · front ·
Lanzar) · **sidebar izq = comercios** · **centro = el mapa** · **sidebar der = configuración** ·
**panel inferior = las consolas** · **barra de estado**. Ninguna zona scrollea a las otras. Antes era una
columna de 2.772 px donde el mapa vivía dentro de un `<details>` plegado **y** en `display:none`, y la
consola no existía hasta que había corrida: las dos cosas que más se miran, escondidas.

**Lo que hace barato reordenarlo, y hay que conservarlo:** el script direcciona el DOM por `id` **225**
veces y por estructura **2**. O sea que mover marcado no toca la lógica — *mientras los `id` no cambien*.
Si agregás algo, engancharlo por `id`.

**Cuatro cosas que ya costaron un rato y no se ven venir:**

- **La configuración se deshabilita durante la corrida, y ahora son TRES `fieldset.cfg`** (header,
  sidebar de config, sidebar de comercios) en vez de uno. Un control de configuración que quede fuera de
  alguno de esos tres **se puede tocar con la corrida andando**. No es una clase decorativa.
- **Cada zona declara su `grid-row` explícito.** `#devwarn` vive en `display:none` casi siempre y un
  elemento así **no ocupa celda**: con auto-placement, todo lo de abajo se corría un renglón y el panel
  de consolas heredaba los 4 px de una manija. Se veía como «la consola desapareció».
- **El CSS manda el `display`, no el script.** El mapa se oculta con `hidden` y `showLog` *borra* la
  declaración inline (`style.display = ''`) en vez de imponer `block`. Una declaración inline le gana
  siempre a la hoja de estilos, y ahí el layout de la zona deja de funcionar.
- **Chrome envuelve el contenido de un `<details>` en `::details-content`**, así que `#trenvias` no es
  hijo flex directo del `#tren`: sin una regla sobre ese pseudo-elemento el lienzo se queda en su alto
  de contenido (152 px) y el `flex: 1` no tiene a quién pedirle espacio.

**El color dice estado, no jerarquía.** El cromo va en grises (lo seleccionado es lo más CLARO); el verde
quedó reservado para `--ok` — corre · sesión ok · servicio arriba · entidad ON —, y ámbar y rojo para lo
suyo. Si pintás cromo con `--ok`, la única señal del panel deja de leerse.

**Lo que NO está hecho:** el mapa **no se mueve durante la corrida**. `renderTren()` se llama al elegir
comercio y al prender/apagar una entidad, nada más — o sea que es una vista de planeamiento previo. Un
minimapa encima de eso sería decoración; lo que le daría sentido es encender el nodo actual cruzando las
rutas que el log ya trae contra las de `steps.json`.

## El mapa del recorrido (`panel/steps.json`)

Canvas SVG **vertical** y arrastrable (drag · rueda = zoom · doble clic = encuadrar), estilo grafo de
git: tronco común hasta `/lenders` y de ahí un carril por `response_type`. Dibuja **solo los carriles
que ese comercio tiene** (mira el `rt` y el `product` de sus entidades). El hover de cada nodo lista los
archivos del paso.

**INVARIANTE: el mapa depende del COMERCIO, no del ambiente.** Describe la lógica de CreditOp, así que el
mismo comercio dibuja el mismo recorrido en local, dev y staging. Dos reglas lo sostienen, y si las rompés
el diagrama vuelve a cambiar de forma según el target (F-64):

- **No filtres por `lender_status`.** Prender o apagar una entidad no cambia POR DÓNDE pasa el flujo, solo
  si hoy lista. Eso se anota (`(apagado)` + carril atenuado), no se borra.
- **Un carril por RECORRIDO, no por entidad.** La clave es `rt + product + desvíos + extensiones`: dos
  entidades del mismo producto recorren lo mismo (es la misma razón por la que el color va por producto).
  Usar la identidad del lender ata el dibujo al padrón de cada base.

Y lo que el mapa **no puede** dibujar hay que decirlo en `#trenwarn`: sin entidades, o sin la columna
`lenders.product` (dev todavía no la tiene), un recorrido vacío o achatado se lee como "este comercio no
tiene esos flujos" cuando en realidad faltó el dato.

**Por qué vertical y no horizontal** (ya se probó y se revirtió): en horizontal la bifurcación cae al final
del tronco y los carriles arrancan al principio, así que la curva de unión vuelve cruzando todo el
diagrama. Medido: bifurcación en x=456, carril de 8 nodos ≈900px, contenedor 1238 → no entra. Girando el
eje, el largo se gasta en alto (que se recorre arrastrando) y la curva queda corta.

**Por qué sin librería de grafos** (D3 / vis-network se evaluaron): son ~20 nodos en carriles paralelos, o
sea posiciones que ya conocemos — un motor de layout no tiene nada que resolver. El criterio: *¿puedo
ubicar los nodos a mano sin que se crucen las aristas?* Si sí, CSS/SVG.

- **Qué cuenta como archivo del paso** (respetalo si lo editás): la ruta del front + los servicios que su
  loader/action invoca, y el controlador del endpoint + los servicios de dominio que llama. **No** utils,
  ni tipos, ni cierre transitivo de imports. Si el número no significa "lo que este paso toca de verdad",
  es decoración con cara de dato.
- **Validá siempre después de tocarlo:** `node bin/steps-check.ts` (sale ≠0 si alguna ruta no existe). El
  panel además muestra un aviso si el chequeo falla — un conteo que ya no resuelve es peor que nada.

## El panel no ofrece lo mismo en todos los targets (`CAPS`)

`bin/advisor` **no levanta lo mismo en cada target**, así que el panel no puede ofrecer las mismas
perillas. Una perilla que no mueve nada es peor que no tenerla: te deja creyendo que probaste algo que
nunca se aplicó. (La matriz de qué es real en cada target está en el `CLAUDE.md`.)

Dos mecanismos, y **no son intercambiables**:

- **`E2E_REAL_PREAPPROVALS`** (en `.env.<target>`, hoy `1` en dev y staging) decide si se usa el mock de
  pre-aprobados. `bin/advisor` lo lee **por la cadena (`envget`)**, no del shell: si lo leyera del shell,
  ponerlo en `.env.dev` no haría nada. El panel pregunta lo mismo al servidor (`/api/lenders` → `mockPA`)
  y muestra el selector de estado por entidad **solo cuando el mock contesta**. Atarlo a una lista de
  targets se desincroniza el día que alguien cambia la variable.
- **`const CAPS`** (en `panel/index.html`) es para lo que **sí** depende del target: hoy solo `flotaLocal`
  (los seis mocks que `bin/advisor:189-199` levanta únicamente en local). Si agregás un target, agregalo
  ahí — el default de `cap()` es el más restrictivo **a propósito**: enumerar targets a mano fue lo que
  dejó a staging afuera del guard de escrituras cuando se sumó.

**En pantalla se avisa solo lo que está ROTO**, no lo que es normal en ese ambiente. Un cartel que dice
"acá esto no aplica" es ruido y se lee como error. Lo que hay que saber para interpretar la vista:

- **sin selector de estado por entidad** → esa corrida usa el MS real; el desenlace lo decide el proveedor.
- **el mapa sin carriles** → esa sucursal no tiene entidades en ese target.
- **los CreditopX en un solo carril `rt2`** → ese ambiente no tiene la columna `lenders.product` (hoy dev)
  y no se pueden separar por producto. Ver **F-64**.

## El panel inferior: dos pestañas a la izquierda y un copiar que copia las DOS

Pestañas `Consola de la corrida` · `SSR del wizard` pegadas al borde izquierdo, y a la derecha el filtro
y `📋 copiar`. **Sin botón de plegar**: la consola es una ZONA del layout con su propia manija de alto,
no una tarjeta que compita por espacio con lo de arriba.

⚠ Ponerlas a la izquierda **no salió con `display:flex` a secas**: medido, quedaban en x=333 y x=798
—dispersas— porque `.copy`/`.pest` arrastran estilos del diseño viejo. Hay que fijarlo explícito
(`justify-content: flex-start` + `flex: 0 0 auto` en las pestañas + `margin-left:auto` en las acciones).

⚠⚠ **`copiar` copia LAS DOS consolas, no la que estés mirando.** Pegar un problema sin el stdout del SSR
es pegar la mitad: las llamadas salientes del servidor (`[outbound]`, con código y duración) **no están**
en el log de la corrida y son justo lo que explica un 500 o un timeout. Van con un encabezado cada una
(`── CONSOLA DE LA CORRIDA ──` / `── SSR DEL WIZARD ──`) para que se sepa de dónde salió cada bloque.
Medido: 19.370 caracteres con las dos.

## El mapa marca DÓNDE VA la corrida

`seguirCorridaEnMapa()` lee la última navegación del log y le pone un halo al nodo correspondiente. Eso
reemplazó a la tarjeta «Actividad de la corrida», que se quitó: repetía lo que ya dicen la consola (el
mensaje del runner, completo), la barra de estado (el contexto) y el header (el cronómetro) — lo único
que le faltaba al panel era **dónde va**, y eso se ve mejor en el mapa que descrito con palabras.

⚠ **El dato ya estaba, sólo que en texto.** Cada navegación que imprime `pkg/trace.ts` arranca con el
número de paso y la RUTA (`03 A /merchant/<hash>/<ureq>/personal-info  │ BD 1 «Creada»`), y `steps.json`
tiene la ruta de cada nodo. El cruce son 21 pasos indexados.

⚠ **Las rutas del mapa son PLANTILLAS** (`/{flow}/{hash}/solicitar`): se comparan convirtiéndolas a
expresión regular con `{...}` → `[^/]+`. Por igualdad no matchearían nunca, porque el hash y el id de la
solicitud cambian en cada corrida.

⚠⚠ **DOS DEFECTOS DEL PARSEO QUE SÓLO UNA CORRIDA REAL MOSTRÓ** (2026-09-18, Motai/local, 17
navegaciones):

1. **El panel DECORA cada línea del runner con `▸ `**, así que la línea es `  ▸ 03 A /merchant/…`, no
   `03 A /…`. Anclar el número al principio no matcheaba **nunca**: la consola mostraba seis navegaciones
   y el mapa seguía sin marcar.
2. **Cuando la ruta es larga, el separador `│` de la columna de BD queda PEGADO** —
   `…/abaco/platform-otp-validation│`— así que capturar con `\S+` se lo tragaba y esa ruta no matcheaba
   ninguna plantilla. Va `[^\s│]+`. Peor modo de falla: las rutas cortas andaban y las largas no, o sea
   parecía funcionar.

**Resultado con la corrida real:** 12 de 17 navegaciones reconocidas, y el recorrido reconstruido es
`monto → otp → personal-info → lenders → confirmation → abaco-init → abaco-otp`. Las 5 que no son huecos
de `steps.json` —`/continue`, `/abaco`, `/identity-validation-instructions`, `/request-canceled`—, no
fallas del cruce: son pantallas reales que el mapa no tiene como nodo. ⚠ Y `identity-validation` **no
está vieja**: los dos caminos existen en `main`, el mapa tiene uno y la corrida pasó por el otro.

**Los cuatro nodos que faltaban se agregaron** (2026-09-18, a partir de esa corrida): `continue` (el
handoff al celular del cliente, al final del tronco), `abaco-entrada` (el índice del desvío, el que puede
SALTEARLO), `identity-validation-instructions` (en el ramal `creditopx`, justo antes de
`identity-validation` — son DOS pantallas y las dos existen en `main`) y `request-canceled`. Con eso,
**11 de 11** rutas distintas de una corrida real se ubican.

⚠ **`request-canceled` NO va en el tronco ni en un ramal: va en `terminales`, una sección nueva.** Se
llega desde varios puntos, así que dibujarla en una secuencia diría que todo el mundo pasa por ahí. El
mapa no la dibuja; el índice del panel sí la usa (para reconocer dónde está la corrida aunque no haya
nodo que marcar) y **`steps-check` valida sus archivos igual que los demás** — una sección que no se
valida se pudre en silencio. Su nota registra lo importante: **su loader CANCELA** (`CancelLoanRequestUc`),
no informa una cancelación ya ocurrida; es el mecanismo de F-50.

⚠ **Un paso dibujado en VARIOS carriles se marca en todos.** `confirmation` y compañía aparecen 3 veces
(una por carril) y los de Ábaco 2. Marcar uno solo sería inventar en cuál carril va la corrida —dato que
el log no da—; marcarlos todos dice «estás en este paso» sin mentir sobre la rama.

⚠ **`tronco` y `bypass` son listas de pasos; `ramales`, `desvios` y `extensiones` NO** — son
diccionarios de `{label, cuando, pasos}` y los pasos están en `.pasos`. Asumir que eran listas revienta
con «(arr || []) is not iterable».

⚠ **`#tipear` NO era parte de esa tarjeta aunque viviera adentro**: son los valores que el runner te pasa
para tipear (el OTP, el documento). Se rescató como franja flotante sobre el mapa. Borrarlo con la
tarjeta habría sacado lo único de ahí que hacía falta.

## El centro es el MAPA, y plegar un sidebar es su zoom-out

**Sin tarjeta**: ni marco, ni fondo, ni la cabecera «Mapa del recorrido · Referencia del flujo». Un
título que rotula la única cosa de su zona es ancho gastado. ⚠ **Pero esa cabecera guardaba
`#trenwarn`** —donde el mapa dice lo que NO pudo dibujar—, y esconderla lo escondía con ella: un mapa
incompleto se vería igual que uno completo, que es justo el modo de falla que ese aviso evita. Así que
no se borró: se muestra **sólo cuando hay algo que avisar** (`summary:has(#trenwarn:not(:empty))`).
Verificado en los dos sentidos.

El mapa ocupa el centro entero y se reencuadra solo al cambiar de tamaño (`ResizeObserver` → `encuadrar()`).
**Sin botones de zoom**: la rueda con **⌘/ctrl** acerca y el **doble clic** encuadra —los dos ya estaban—,
así que los botones eran de cuando la rueda pelada la secuestraba el canvas.

⚠ **La escala se clava en 0,55 y NO es un bug: es el piso.** Medido con Motai: el mapa mide **2.026 px**
de ancho natural y el centro flanqueado por los dos sidebars son **724** — para que entrara entero haría
falta **0,36**, y a esa escala las etiquetas quedan en ~4 px. Lo que sí resuelve el problema es **plegar
un sidebar**, que ahora se puede:

| | lienzo | escala | ¿entra entero? |
|---|---|---|---|
| con los dos paneles | 724 px | 0,55 (piso) | no |
| sin el izquierdo | 1.024 px | 0,55 | no |
| **sin ninguno** | **1.364 px** | **0,64** | **sí** |

O sea que el colapso a 0 no es sólo para ganar lugar: es la forma de ver el recorrido completo.

## Lo que se sacó del panel, y por qué

**«Perfiles reutilizables» (borrado el 2026-09-18).** Guardaba ingreso, ocupación, email, score,
negativos y consultas con un nombre, en el `localStorage` del navegador. Se sacó **no** por estar sin
usar —eso no se puede probar desde acá: el navegador del agente no es el de Miguel— sino porque
**`harness/suites/*.json` cubre la misma necesidad y mejor**: guarda los mismos valores **más lo que se
espera**, está versionado en git, se comparte con el equipo y se corre por consola con veredicto
(`make harness-suite`). Ya hay ocho suites escritas. Un perfil en `localStorage` no es ninguna de esas
cosas: es por navegador, invisible desde afuera y se pierde al limpiar datos del sitio.

Si aparece de nuevo la necesidad de «un juego de valores que uso seguido», el lugar es una suite, no una
perilla del panel.

## El sidebar derecho: dos vistas, «Cliente» y «Comercio» (2026-09-25)

Dos pestañas en la banda (`#tabClient` · `#tabMerchant`), y cada una es de un sujeto distinto:
**Cliente** es la persona que pide el crédito (lo que describen las secciones de abajo) y **Comercio** es
dónde lo pide: su nombre y sucursal, la **configuración del comercio** y sus **entidades** (las mismas
filas de antes, mudadas del árbol). Cada vista es su propio `fieldset.cfg`, así que la corrida deshabilita
las dos. La pestaña elegida se recuerda (`harness.auxView`).

**La configuración del comercio escribe `allieds`** (hoy sólo `initial_fee`): `bin/dbops.ts merchant-flags`
lee y `merchant-flag-set` escribe, con los flags en la lista blanca `MERCHANT_FLAGS` —el nombre llega del
panel y termina en un `UPDATE`—. El panel los llama por `/api/merchant-flags` y `/api/merchant-flag`.

- ⚠ **Sólo en local, y el servidor lo niega aunque la guarda de `dbops` también frenaría**: cambiar un
  flag cambia el comercio ENTERO —todas sus sucursales— y en dev, qa y staging la base es del equipo. En
  otro ambiente el interruptor queda deshabilitado con el motivo en el tooltip.
- ⚠ **Queda puesto después de la corrida.** Por eso la vista guarda cómo estaba cada comercio la primera
  vez que se abrió en esa sesión del panel, marca «Modificada» mientras difiera y ofrece volver.
- ⚠ **El front tarda hasta 60 s en verlo**: cachea el perfil del asesor (`USER_DATA_CACHE_TTL_MS`), y de
  ahí saca `initial_fee`. Medido el 2026-09-25: la primera prueba de Motai corrió con el comercio anterior.
  La vista cuenta hacia atrás, y sólo para el comercio que se cambió.
- ⚠ **El flag sólo decide el listado del ASESOR**: la tienda nunca muestra el campo y la autogestión no
  recibe el perfil del comercio. Con otro canal, la vista lo avisa.
- Los avisos (canal y espera) van en su propio renglón ámbar que ENVUELVE (`.prop-hint.flag-alert`); la
  explicación sigue la regla de las pistas: un renglón y el texto entero en el tooltip.

## El sidebar derecho: UN panel de propiedades, sin secciones

**Cuatro grupos, todo a la vista, sin un solo plegable:** `Caso` (monto · cupo) · `Identidad` (los ocho
campos + celular) · `Ingreso y empleo` · `Buró` (modo + los tres de Datacrédito). Dejaron de ser
plegables cuando **«Arranque» subió al header**: sin él «Caso» quedaba en dos filas, y una sección
plegable con dos filas adentro gasta en su título y su resumen más de lo que ahorra.

⚠ Y con las filas de 24 px **entra todo sin scroll**: 20 filas, contenido 696 = alto visible, `scroll 0`.
Por eso se pudo desplegar Identidad —que estaba plegada justamente porque antes no entraba— y su
resumen (`updateIdSum`) quedó vacío a propósito: con los ocho campos a la vista no hay nada que
resumir.

⚠⚠ **LECCIÓN DE MÉTODO, y costó tres reparaciones:** este archivo se editó cortando HTML por marcadores
(«desde tal `<div>` hasta el último `</div>`»), y eso **no respeta el anidado**. El resultado fue perder
tres campos (`income`, `occupation`, `phone`), después duplicar el bloque de Datacrédito, y al final
descubrir que el `<details>` de Identidad y el `.field` del email habían quedado **sin cerrar** — el
navegador no protesta, simplemente anida mal y las filas se pisan. Lo que sí funcionó: **reconstruir el
bloque desde `git show HEAD:…`** en vez de seguir parchando. Antes de dar por buena una cirugía de
marcado acá, contá las etiquetas del tramo:

    <div: N   </div>: N   ·   <details: M   </details>: M

## El sidebar derecho: panel de PROPIEDADES, no formulario

Cada propiedad es **una fila de 24 px**: etiqueta a la izquierda en una columna fija de 102 px, control a
la derecha — como un panel de herramientas de Blender o Photoshop. ⚠ **Medido:** cada `.field` medía
**62 px** (etiqueta arriba, control abajo, margen) y diecisiete campos daban **1.236 px** de contenido en
546 visibles. Ahora el sidebar **cerrado mide 546 = exactamente lo que se ve, scroll 0**, y con TODAS las
secciones abiertas 808.

La etiqueta arriba del control tiene sentido en un formulario que se llena una vez; esto es un panel que
se ajusta muchas veces, y ahí lo que importa es ver **todas las perillas juntas**. Los segmentados pasan
a chips que caben en la fila, los pares (`.two`) se apilan —a 340 px, «Negativos 12m» + su input en media
columna no entra— y las etiquetas largas se recortan con su texto completo en el `title`.

⚠ Una fila que se sale de los 24 px es una señal, no un detalle: la de sólo-lectura del celular medía
**91** porque sus cuatro partes envolvían dentro del campo. Se alinea con la misma columna y la
aclaración larga se va al tooltip. La única que queda alta a propósito es «Modo del buró» (51 px:
etiqueta + chips + su pista de una línea).

## Las secciones, y el resumen dice CÓMO está

`Caso` · `Persona` · `Buró` · `Avanzadas`, cada una plegable y recordando su estado (localStorage, por
máquina). **Medido antes:** 1.097 px de contenido en 546 px visibles —551 de scroll, más de lo que se
ve— y `personCard` sola medía **727 px**, más que el viewport, **ya con sus tres plegables cerrados**. O
sea que no faltaba plegar, faltaba estructura. **Después: 644 px y 98 de scroll.**

⚠ **El resumen de una sección dice CÓMO ESTÁ, no de qué se trata** —`$2.000.000 · inicio`, `score 700`,
`sin inyección — lo decide el ambiente`—: cerrada, esa es la única línea que se lee. Es la misma regla
que el panel ya aplicaba en «Configuración del entorno». Lo recalcula **un oyente delegado** sobre el
sidebar más una llamada en `refresh()`: enganchar campo por campo es la forma de que el día que se
agregue uno, su resumen quede viejo sin que nadie lo note.

⚠ **`.sintetico` reemplazó a `#synthbody`** como blanco del atenuado por «Sin inyección». Ahora son DOS
bloques (los datos de la persona y los números del buró) y **el interruptor de modo quedó afuera a
propósito**: atenuarlo lo vuelve inclickeable y no habría forma de volver. Verificado en los dos
sentidos. ⚠ En `local` ese botón está deshabilitado (no hay burós reales), así que probarlo clickeando
ahí no concluye nada — hay que llamar a `applyInjMode()` con `inject` cambiado.

**Las pistas largas viven en el tooltip y dejan un renglón** (`.pista`, 17 px). No se borran: varias son
la única explicación de por qué una perilla hace lo que hace. ⚠ El `title` se **sincroniza con el
texto** por `MutationObserver`, no se escribe a mano: el panel las reescribe cada vez que cambiás la
opción, y un tooltip fijo diría lo de la elección anterior.

## El header: dos menús y un estado, no una tira de pastillas

`Entorno ▾` · `Canal ▾` a la izquierda, y a la derecha —pegado a Lanzar— el **estado de los servicios**
(`● falta minio/documentos`), que abre el detalle completo con sus comandos. Antes el header llevaba
cuatro pastillas de ambiente + admin + dos botones de front + su pista recortada a 22 caracteres, y el
estado vivía plegado en un `<details>` del sidebar — o sea que **la respuesta a «¿puedo correr?» estaba
escondida** detrás de un click, cuando es lo primero que hay que saber.

**El CASO (monto · cupo · arranque) vive en el CENTRO, arriba del mapa** — no en el sidebar. Es lo que
define la corrida y el mapa de abajo dibuja ese mismo recorrido: leerlos juntos es la mitad del sentido.
⚠ Va envuelto en **su propio `fieldset.cfg`**: al salir del sidebar tuvo que llevarse consigo la
propiedad de deshabilitarse mientras la corrida anda, o se podría cambiar el monto con el wizard abierto.

**Las manijas colapsan el panel a 0 al pasarse del mínimo** (con 28 px de histéresis, para que no se
cierre de un temblor), y la manija se marca sola cuando su panel está plegado — si no, queda una línea
muerta que nadie sabe que se arrastra. ⚠ **La zona de agarre son 16 px aunque la línea se vea de 4**
(`::before` con `left:-6/right:-6`): medido con `elementFromPoint`, apuntarle a 4 px falla, y ahora es lo
ÚNICO que trae de vuelta un panel colapsado.

**El header lleva cuatro perillas de la corrida:** `Entorno ▾` · `Canal ▾` · `Arranque ▾` · `⏱`. Las
cuatro son de la CORRIDA, no del comercio ni de la entidad — por eso viven juntas ahí.

⚠⚠ **LOS MENÚS SON UNA VISTA DE LOS BOTONES REALES, que siguen en el DOM ocultos** (`#tbcfg`,
`#canalField`). El menú lee su estado (`.on`, `disabled`, `title`) y les pasa el `click()`. No es un
rodeo: el gateo de canales pone `disabled` + opacidad + **un `title` distinto por caso** (`applyCanal`,
con el párrafo largo de por qué en Corbeta el asesor no está roto), y reimplementarlo en el menú serían
dos definiciones de la misma regla — y la del menú sería la que se olvida de actualizarse. Verificado: el
menú muestra «QR en caja» apagado con su motivo íntegro, y «Del ambiente» apagado cuando el target no
tiene front desplegado. Y siguen dentro del `fieldset.cfg`, así que la corrida los deshabilita igual.

**El reloj ⏱ cicla la demora del mock de pre-aprobación** (0 → 3 → 5 → 10 → 15 s) y reemplazó a la
sección «Avanzadas», que gastaba un título entero para una sola perilla.

⚠ **Está en el HEADER y no en una fila del árbol a propósito.** La demora es **de la corrida** —viaja
como una sola `MOCK_PA_DELAY_MS` al lanzar—, no de la sucursal ni de la entidad. Un reloj en la fila de
una sucursal diría que cada sucursal tiene la suya, que es falso; es la misma clase de mentira que el
panel evita con `CAPS`. Y respeta el gate que ya existía: con el **MS real** `applyMockPAGate()` lo
resetea a 0 y el botón queda **deshabilitado con su motivo** en el tooltip, no escondido.

⚠⚠ **EL CIERRE POR CLICK-AFUERA TIENE QUE PREGUNTAR SI FUE AFUERA** (`cerrarSiEsAfuera`). Registrar
`cerrarMenuEntidad` directo en `document` y en fase de CAPTURA hacía que **cualquier** `pointerdown`
—incluido el del ítem que ibas a elegir— cerrara el menú; y `pointerdown` ocurre ANTES que `click`, así
que para cuando el navegador resolvía el click el ítem ya no estaba en el documento y su acción **no
corría nunca**. Síntoma: «los menús del header no hacen nada». Afectaba a los cuatro y al del click
derecho.

⚠ Y el `stopPropagation` del propio menú **no alcanzaba**: está en burbujeo y el cierre corría en
captura, o sea antes. Por eso el bug sobrevivió a tener esa línea puesta.

⚠⚠ **Y POR QUÉ NO LO ATRAPÉ PROBANDO, que es la lección transferible:** las pruebas clickeaban con
`elemento.click()`, que **no dispara `pointerdown`** — el menú no se cerraba y la acción corría. Verde en
la prueba, muerto con el mouse. **Para probar un menú hay que despachar la secuencia real**
(`pointerdown` → `pointerup` → `click`) o mover el mouse de verdad; `.click()` solo no prueba nada de un
componente que reacciona a `pointerdown`.

⚠ **Tres nodos se PRESTAN a los menús** —`#fronthint`, `#canalhint`, `#healthDetails`— en vez de
duplicarse, y `cerrarMenuEntidad()` **los devuelve a su casa antes de borrar el menú**. La casa se anota
al arrancar (`CASA`), porque si los tres volvieran al mismo lugar la pista del front terminaría bajo el
rótulo del canal: no rompe nada, que es lo peor que puede pasar. Si el menú se removiera con ellos
adentro, desaparecen del documento y `loadEstado()` sigue escribiendo en la nada, sin fallar.

## El árbol: una ENTRADA por fila, con su sucursal fija

Una entrada del espacio = **un par (comercio, sucursal) con tu nombre** = una fila. **Un nivel**: desde
el 2026-09-25 la fila no se despliega, ABRE el comercio (el mapa al centro y la pestaña «Comercio» a la
derecha), y sus entidades viven en esa pestaña, no colgadas del árbol. Hasta entonces `renderMerchants()`
movía el bloque de entidades debajo de la fila elegida y tenía que rescatarlo antes de limpiar el árbol.

⚠ **NO hay «cambiar de sucursal», a propósito.** La sucursal se elige UNA VEZ, al agregar el comercio, y
después no se toca: si querés otra, agregás el comercio de nuevo eligiendo esa. Por eso el mismo comercio
puede estar varias veces —«Sonría · Restrepo» y «Sonría · Chapinero»—, y por eso se puede **RENOMBRAR**:
sin el rótulo no se distinguen. Es menos lógica que un selector con su estado y encima deja las dos
configuraciones **a la vista al mismo tiempo**, que es lo que sirve para compararlas. Y comparar es un
caso real: medido el 2026-09-18, Sonría tiene **8 juegos de entidades distintos** entre sus 79 sucursales
(Alkosto, 23 sucursales, tiene **uno**).

⚠ **Renombrar: TODAS. Borrar: sólo las tuyas.** El nombre es una etiqueta de esta máquina
(`.flows.json` está gitignoreado) y hace falta para distinguir repetidos, así que el guard del servidor
se relajó para `rename` y se endureció para `remove`: los diez curados viven en el CÓDIGO por lo que
ejercitan, y desde la UI no habría forma de traerlos de vuelta. ⚠ El alias de un curado viaja por
**`/api/branches`** y no por `/api/favs`, que filtra por `fav` — sin eso el renombre se guarda y no se ve.

## Elegir comercio: los curados y el buscador

Conviven dos entradas, y **no son redundantes**:

- **Las tarjetas** (`MERCHANTS` en `panel/index.html`) están curadas por lo que **ejercitan** — Motai =
  renting/RTO, CeluRD = SmartPay/IMEI, Sonría = el listado más rico, Mediarte = rt2 al 0% con Credifamilia
  rt4 al lado, Alkosto = el canal QR. Eso es conocimiento, no comodidad: no las cambies por el buscador.
- **El buscador** va contra la BD del target, en **dos pasos: comercio → SUCURSAL**. El segundo paso no es
  adorno: lo que se lanza es un hash de **sucursal**, y `dbops list` devuelve `MIN(hash)` — buscar "motai"
  da `5cb92b54` (*Motai Boyaca*), no `f0548728` (*PRINCIPAL*). Resolver "una sucursal cualquiera" ya causó
  que la card mostrara una y el flujo corriera contra otra.

Al elegir del buscador, el `slug` **es el hash**: `.flows.json` no conoce esa sucursal, y tanto
`branchHashForSlug` (panel) como `bin/advisor` caen a "si parece hash de 8 hex, es el hash".

**★ Guardar como favorito** lo escribe en `.flows.json` con el nombre que quieras y `fav: true`. No es
cosmético: desde ahí `bin/advisor <slug>` lo reconoce **desde la terminal**, no solo el panel. El `fav`
existe para poder renombrar/borrar **solo los tuyos** — los curados no se tocan desde la UI. Y
**renombrar NO cambia el slug**: es la clave con la que un comando guardado ya funciona.

## El switch de FRONT: el pool de Cognito lo trae el front, no el target

Switch **Frontend**: *Del ambiente* (el desplegado del target) o *Local :5174* (tu working copy). Existe
para ver un cambio del front contra `qa` **sin esperar el deploy**. Por CLI es `CFE_FRONT=local|ambiente`.
La opción "del ambiente" aparece solo si ese target tiene un front desplegado configurado
(`E2E_BASE_URL`), y eso lo resuelve el servidor por la **misma cadena** que `bin/advisor` — no una lista de
targets en el panel, que se desincronizaría.

⚠ **Con front local, el pool de Cognito es el de DEV aunque el backend sea el de qa.** El wizard local trae
su propia config de Cognito en el `.env` del monorepo (`login.creditop.com` + su `client_id`) y
`bin/advisor` solo le pisa las URLs de API. Consecuencias, las dos ya cableadas:

- la corrida entra con el **asesor de prueba del comercio** (`c<hash>-fake@creditop.com`) y la clave compartida
  `ALLIED_TEST_ADVISOR_PASSWORD` del pool de **dev** (`connectors/.env.dev`), no del target: el conector decide el
  ambiente de autenticación por el origen del front;
- la sesión se guarda por **front y cuenta**, no por target (`connectors/.auth/sessions/advisor-<t>-<host>-…-<cuenta>.json`):
  `staging + front local` usa la de dev. Guardarla como 'staging' hacía replayar cookies de OTRO origen y
  re-loguear contra el pool equivocado — se ve como un login que se queda en `verifyPassword` hasta el
  timeout, que es lo que pasó la primera vez que se probó el switch.

Funciona porque **dev y staging comparten la BD**: el `sub` del asesor es el mismo para los dos backends,
así que el permiso a la sucursal vale igual. Si algún día dejaran de compartirla, esto se rompe.

## `CFE_FRONT` es un SWITCH, no una ruta (y el log del wizard mentía)

Dos bugs de `bin/advisor` que juntos costaban 8 minutos por corrida, arreglados el 2026-07-31 — si tocás
esa zona, **no los deshagas**:

- **`CFE_FRONT` tenía dos sentidos.** Abajo es el switch de front (`local|ambiente`, que es **lo que manda
  el panel**) y arriba se usaba como la RUTA del monorepo. Con `CFE_FRONT=local` la ruta quedaba en
  `local/apps/loan-request-wizard` → `cd: No such file or directory`, el wizard nunca arrancaba **y el
  script igual esperaba 480 s "compilando"** antes de rendirse. Ahora se resuelve por valor: `local` y
  `ambiente` son modos; cualquier otro valor sigue siendo una ruta (compat), y `CFE_FRONT_PATH` la fija
  explícita. Se agregó un guard: si el directorio no existe, corta al instante con el path a la vista.
- **El log del wizard no se truncaba antes de lanzar.** Si el arranque fallaba sin llegar a escribir, el
  `tail -15` mostraba el log de la corrida ANTERIOR: un `Cannot find module '@radix-ui/react-collapsible'`
  ya resuelto seguía apareciendo como si fuera el fallo actual y mandó a buscar donde no era. Ahora se
  trunca (`: > /tmp/asesor-wizard.log`) antes del `nohup`.

**Lección transferible:** cuando el arnés espera minutos y después culpa a un log, sospechá del log antes
que del producto. Un error viejo presentado como actual es peor que no tener log.

## Comprobación de BD al cerrar la corrida (`dbops activity`)

Al **terminar** la corrida (Detener o fin natural — `child.on('close')` en `panel/server.ts`) el panel hace
**UNA** consulta `dbops activity <duración>`, deriva el veredicto (estado final, flujo, si se
consultó/inyectó el buró) y lo vuelca a **la consola de la corrida** (queda ahí como post-mortem) + a
`.runs/`. Existe porque el modo **manual** del panel es ciego: la pantalla muestra la *pretensión* y nadie
muestra lo que se persistió (el patrón de F-50). Complementa a `pkg/trace.ts`, que solo corre en el guiado.

**No se pollea durante la corrida (2026-07-22).** Antes se consultaba cada 2s y se pintaba una grilla de
puntos por tabla; se sacó porque cada tick arrancaba un proceso + una conexión nueva a dev (~700ms) y
cargaba la BD **compartida** casi a la mitad del tiempo, sin aportar mucho. La foto al cierre alcanza y es
más barata.

Tres cosas que hay que respetar si lo tocás:

- **La ventana la mide la BD**, no node: `dbops activity <segundos>` filtra con `NOW() - INTERVAL n
  SECOND`. Contra dev la base es remota y comparar contra el reloj local perdería eventos o traería basura
  vieja. Al cierre, `<segundos>` = duración de la corrida.
- **Las 9 tablas van EN PARALELO, cada una en su propio `try`** (`Promise.all` en `bin/dbops.ts`): si una
  columna no existe en ese ambiente se pierde ESA fila, no la vista entera (lección de F-64), y contra dev
  no se pagan 9 round-trips en serie.
- **Alcance declarado, no omnisciencia.** Son 9 tablas curadas y solo filas del usuario de la corrida. No
  es un tail del binlog —dev es compartida y todo el equipo escribe— y **no ve DELETEs** (el scrub borra
  antes de que el usuario exista, así que queda fuera igual). `displayed_lenders` **no existe**: verificá
  contra el esquema antes de sumar una tabla, no contra la memoria.

## El gate de canales

El panel gatea los canales por comercio y **la regla la decide el servidor** (`/api/canales?slug=`), no la
UI: si la UI re-derivara "esto es Corbeta" habría dos definiciones de la misma cosa. El servidor resuelve
con `bin/dbops.ts is-corbeta <hash>`, que lee el **mismo `Setting('corbeta_allieds')`** que usa el producto
en sus 3 sitios.

- **Corbeta → solo `qr`.** Detalle y el motivo exacto (que NO es "asesor está roto"): skill
  `harness-canal-qr`.
- **Cualquier otro → `asesor` · `ecommerce`.** El QR no aplica: `oldIndex` solo redirige al self-service a
  los allieds del setting; para el resto cae en `registrar-celular/{hash}`, que es el mismo tronco del
  asesor → ofrecerlo sería una perilla que no mueve nada.
- **El canal que no aplica se DESHABILITA, no se esconde** (con `title` explicando por qué). Verlo apagado
  dice que existe y que acá no corresponde; esconderlo hace creer que no existe.
- Si cambiás de comercio y el canal elegido deja de aplicar, se cae al primero permitido; si sigue
  aplicando, **no se toca** (verificado en el navegador).

**Los arranques («saltar a») también se gatean, y por CANAL** (`applyPasoGate()`): el salto es del tronco
`/merchant/*` y no todos los canales lo recorren.

| Canal | Inicio | Lenders | Por qué |
|---|---|---|---|
| `asesor` | sí | sí (con buró Sintético) | recorre el tronco |
| `ecommerce` | sí | **no** | `DIRECT_LENDERS` exige `ENTRY !== 'ecommerce'` → elegirlo no haría nada |
| `qr` | **no** | **no** | recorrido propio (registro → OTP → producto): ni monto ni marketplace |

Se apilan con el gate por modo de buró (Lenders siembra un sintético → con buró Real no hay nada que
sembrar). Cuando un arranque deja de aplicar, `step` cae a `monto` solo.

El selector de **canal** cambia la PUERTA, no el caso: el usuario sintético es el mismo y viaja **adentro**
de la URL base64, así podés correr la misma identidad entrando por asesor y por tienda y comparar.

- `asesor` → `bin/advisor`, login Cognito, wizard en `/merchant`.
- `ecommerce` → `bin/ecommerce` + `E2E_ENTRY=ecommerce` (ver skill `harness-canal-ecommerce`).
- `qr` → `bin/qr` + `E2E_ENTRY=qr` (ver skill `harness-canal-qr`).

## El botón `admin ↗` — y por qué local es distinto de los remotos

Abre el admin de `legacy-application` **del target que esté elegido** (`dev/open-admin.ts <ruta> <target>`),
en su propia ventana. Es un atajo de MIRAR: la mitad de la config que el flujo lee —comercios, entidades,
puntos de venta— se toca ahí.

| target | qué hace |
|---|---|
| `local` | levanta `artisan serve` y `vite` si hacen falta, y **entra sin contraseña** |
| `dev` · `staging` | abre la URL con un **perfil persistente** en `.auth/admin-<target>` |
| `qa` | no tiene admin propio (`admin.qa.creditop.com` no resuelve) — usá `dev`, comparten base |
| producción | **no está, a propósito** |

**Local entra sin contraseña** porque `bin/admin-session` emite la sesión con el guard real de Laravel — hay
`artisan` a mano, y el PHP aborta si `APP_ENV` no es `local`.

**Los remotos no pueden entrar así**: no hay shell en esos contenedores, y `SESSION_DRIVER=file` — la
sesión vive en un archivo del servidor, así que una emitida en local no existe allá. Tampoco hay un bypass
de login por ambiente, como sí lo hay para el OTP.

Lo que hacen en cambio, en este orden:

1. **El perfil recuerda.** Cada target tiene el suyo en `.auth/admin-<target>`: te logueás una vez y las
   siguientes entra solo. Son cookies en disco, el mismo mecanismo con el que un navegador te recuerda.
2. **Y si hay credencial, completa el formulario.** El de siempre — no hay puerta trasera. Lee
   `E2E_ADMIN_USER_<TARGET>`/`E2E_ADMIN_PASS_<TARGET>`, si no los genéricos `E2E_ADMIN_USER`/`PASS`, y si
   no el `.admin.json` **gitignoreado** que ya usaba `dev/admin-cities.spec.ts`. Acepta la forma plana
   `{user, pass}` que ya existía y, opcionalmente, una por target —`{"dev": {…}, "staging": {…}}`— porque
   los dos admin son despliegues distintos y pueden tener usuarios distintos. La plantilla:
   `.admin.json.example`.

⚠ Si el `fill` falla porque el formulario cambió, **no rompe nada**: avisa y la ventana queda en el login
para entrar a mano.

⚠ **`.auth/` y `.admin.json` están gitignoreados**, y ahí quedan una sesión de admin viva y una
contraseña. No los commitees ni los compartas.

⚠ **Producción queda afuera a propósito.** Esto es el panel con el que se corren flujos de prueba; un click
al admin de producción al lado del botón de correr un caso es un accidente esperando. Si hace falta entrar,
se entra por el navegador de siempre.

⚠ Y **`vite` sólo se levanta en local**: sin él Laravel sirve el bundle COMPILADO, que puede tener meses, y
verías la pantalla vieja pensando que tu cambio no funcionó.

⚠ **El vite del admin se reconoce por `public/hot`, no por el puerto 5173.** Ese archivo lo escribe el vite DEL ADMIN
con la URL donde quedó, y Laravel manda al navegador a buscar ahí los assets. Preguntar «¿responde algo en :5173?»
daba por arriba al wizard de otra sesión que ocupaba el puerto, con un `hot` viejo apuntando a un vite muerto: el
admin cargaba en BLANCO (2026-10-19). Si el de `hot` no responde se levanta de nuevo, y si no arranca se borra el
`hot` para caer al bundle compilado.

## La vista «Admin»: el admin en una PC dentro del panel (2026-10-19)

Arriba del centro, **`Originación | Admin`** (`#stageViews`). «Originación» son los dos celulares de siempre; «Admin»
es una **PC** con el admin de `legacy-application` del ambiente elegido, **ya logueada**, que se ve y se toca como
los celulares. La vista elegida se recuerda (`harness.stageView`).

- **Es el mismo mecanismo que los celulares**, un tercer dispositivo `admin` en `panel/devices.ts`: un navegador
  del servidor transmitido al lienzo `#adminLive` por `/api/device/admin/live`, con los toques de vuelta por el
  mismo canal. Un iframe no sirve: el admin manda `X-Frame-Options: SAMEORIGIN`.
- **Pantalla de escritorio, 1366×768**, en su PROPIO Chromium (`openDesktop`): el de los celulares se lanza
  forzando 3× y a esa escala una pantalla de escritorio son cuadros de 4.098 px. La PC va a 1,5×
  (`HARNESS_DESKTOP_SCALE`). El hueco de la pantalla en el panel tiene exactamente esa proporción: así el lienzo
  no se recorta y el clic cae donde se ve.
- **Entra por `pkg/admin-access.ts`, lo mismo que el botón `admin ↗`** (`dev/open-admin.ts`): local emite la
  sesión sin contraseña; dev y staging usan la guardada por `make harness-signin KIND=admin TARGET=<t>`; **qa abre
  el de dev** (comparten la base) y **producción no está**. Si la sesión venció, la PC queda en el login y el chip
  «pide entrar» dice el comando.
- **El chip del ambiente va en ámbar fuera de local**: en dev, qa y staging la base es COMPARTIDA y lo que se
  cambie desde la PC lo ve el equipo.
- **La PC no usa el wizard**: lanzar una corrida o precalentar NO la cierra ni la cuenta como celular abierto, y
  no deja navegador de reserva (se abre de vez en cuando).
- ⚠ **El admin local lee la base local**: con `legacy-backend-mysql-1` apagado la sesión no se emite («no se pudo
  emitir la sesión del admin local»). Levantá la base antes.

## La vista «Prod»: la corrida de producción desde el panel (2026-10-19)

Tercera pestaña del centro (`Originación | Admin | Prod`). El panel NO es otro motor: lanza `dev/prod-run.ts` —el
mismo de la consola, con todas sus comprobaciones— por `POST /api/prod-run` y le pasa el OTP por su entrada estándar
(`POST /api/prod-run/otp`); `GET /api/prod-run` da su estado y su salida. La salida va a la tarjeta y también a la
consola de la corrida (para copiarla), sin mezclarse con el estado de las corridas del wizard.

- **«Correr en prod» sólo se habilita después de un «Comprobar» que pasó** en esa sesión del panel, y pide
  confirmación: la vista previa es la que dice que la cédula está permitida, la sucursal no tiene entidades ni
  Experian, no hay cliente activo y la VPN de prod está.
- **El OTP llega por SMS real**: la tarjeta muestra el campo cuando el proceso imprime `código del SMS:`.
- Lo que crea en prod y por qué para antes del listado: `harness/CLAUDE.md`, fila de `dev/prod-run.ts`.


## El plan de corrida: una corrida armada que espera su play (2026-10-20)

Un agente (o vos) deja la corrida ARMADA y Miguel sólo entra al panel y le da play. El formato, la validación y el
archivo viven en `pkg/run-plan.ts`; se escribe con `make harness-plan FILE=plan.json` (`FILE=-` por la entrada
estándar, sin `FILE` muestra el que espera, `CLEAR=1` lo descarta) o por `POST /api/plan`, y los dos validan con la
misma función. Uno por máquina, en `.runs/plan.json` (fuera de git).

    {"nombre": "Pullman · CrediPullman por asesor", "target": "local", "comercio": "pullman", "canal": "asesor",
     "lender": "CrediPullman", "caso": {"amount": 3000000, "income": 2800000, "score": 720}, "play": "manual"}

- **Es un caso de suite sin `espera`**: mismas claves del caso (los ids de los campos del panel) y `lender`. Una suite
  corre por consola con veredicto; el plan prepara el panel para MIRARLO. Si sirvió, pasarlo a suite es agregarle lo
  que se espera. No inventes un tercer formato.
- **La franja `#planBar` vive DENTRO del centro** (sólo con plan; nada de banners globales) y se vuelve a leer al
  volver a la pestaña: el agente puede dejarlo con el panel ya abierto.
- **«Paso a paso» aplica el plan por los MISMOS caminos que la persona**: el botón real del ambiente, la ruta
  (`applyRoute`, que respeta el gate de canales) y cada campo con su `input`/`change`. Si el canal no aplica al
  comercio, el botón queda apagado como siempre y el plan lo DICE en vez de saltearlo. Después abre el celular:
  asesor → `playMerchant`, ecommerce → «Pagar con Creditop» de la tienda.
- **`lender` todavía no se elige solo**: la franja lo recuerda («en el listado elegí CrediPullman»). Elegirlo, cruzar
  el traspaso al cliente y seguir hasta el final es el ⏩ «Corrida completa», que falta; un plan con `play: "auto"`
  se acepta y la franja avisa que por ahora va paso a paso. La base es `advanceAll` (`server.ts`), que hoy toca el
  botón principal de UN celular.
- Verificado el 2026-10-20 en un panel de prueba (`PANEL_PORT=5196 HARNESS_MOCKS=0 HARNESS_DEVICES_SLOT=1`), local:
  el plan de arriba dejó ambiente, Pullman, canal y caso, y el celular del asesor abrió en `/merchant/13874eb6/solicitar`
  con $3.000.000. El camino de ecommerce NO se probó todavía.

## Las pestañas del editor: una por corrida (2026-10-20)

La banda de arriba del centro (`#runTabs`, el `.tabs` de la base) lleva una pestaña por CORRIDA: un comercio con su
canal y su caso. El selector `Originación | Admin | Prod` se mudó a su borde derecho (`.region-actions`), con los
mismos `id`.

- **Click en un comercio de la izquierda abre su pestaña en VISTA PREVIA** (itálica): la reemplaza el próximo
  comercio que elijas, y pregunta el canal (`#tabStart`). Elegido, queda fija. El chip de canal de la fila abre
  directo la pestaña con ese canal, y el ▶ la de Asesor y entra. El mismo comercio puede estar dos veces.
- **La pregunta del canal es una VISTA de los botones reales** (`#channelOptions`): copia su `disabled` y su `title`,
  así el gate de canales sigue siendo uno. Hasta que llegan los canales de ESE comercio (`channelsFor`) dice
  «midiendo»: los botones reales todavía tendrían los del anterior.
- **La pestaña no es otro estado**: al activarla aplica el que ya existe (`chooseEntry`, el botón del canal, cada
  campo con su `input`). Al salir se fotografía su caso (`snapshotTabCase`) y al volver se repone. Se recuerdan en
  `localStorage` (`harness.tabs`).
- ⚠ **Con canal elegido, la SUGERENCIA del servidor no aplica**: `activateTab` deja `channelTouched` en el comercio
  antes de que conteste `/api/canales`. Sin eso, al volver a Sonría su respuesta la ponía en autogestión y
  `tabsFollow` se lo copiaba a la pestaña (medido el 2026-10-20).
- ⚠ **Ya había un `restoreCase()` global** (el caso guardado al arrancar): las funciones de las pestañas llevan
  nombres propios. En el script clásico, una función declarada después PISA a la anterior sin avisar.
- **Los celulares son UNO todavía**: la pestaña que los abrió es su dueña (`liveTab`, el punto verde). Mirando otra,
  el centro dice «Los celulares están con…» (`#tabBusy`) con «Ir a esa pestaña» y «Cerrar esa corrida»; abrir en otra
  pide confirmar y cierra la anterior (`claimDevices`, que llaman `playMerchant` y `openClientBrowser`).
- **El comercio que cambia por OTRO camino** (la ruta, el plan, el buscador, el menú de canal) lo sigue
  `tabsFollow`, enganchado en `routeChanged`: la pestaña activa si es del mismo comercio; si no, la suya o una nueva.
- Lo que falta: carriles en el servidor para que dos pestañas corran A LA VEZ (ids por carril e identidad
  sintética propia de cada una). Verificado el 2026-10-20 en un panel de prueba en local: pestaña nueva con la
  pregunta (Sonría: Auto y QR apagados), cambio de pestañas con canal y monto propios, chip «T» → Pullman · Tienda,
  el celular del asesor atado a su pestaña y el aviso en otra, «Cerrar esa corrida», cerrar una pestaña.

### Un juego de pestañas por AMBIENTE, la configuración por pestaña y el Admin en la barra (2026-10-20)

- **Cada ambiente tiene su juego** (`harness.tabs.v2` = `{sets: {local, qa…}, live}`): cambiar de ambiente fotografía
  la pestaña activa, guarda ese juego y trae el del otro (`switchTabSet`, escuchando DESPUÉS del `onclick` del botón
  real; un botón apagado no cambia `target` y no pasa nada). ⚠ `tabsTarget` es el ambiente del juego cargado: mientras
  difiere de `target`, `tabsFollow` no escribe. **Producción no tiene pestañas**: el panel no abre celulares ahí.
  ⚠ Si el ambiente no está disponible (sin VPN de dev), el panel vuelve a local solo y el juego vuelve con él.
- **La pestaña guarda el caso Y las perillas del sidebar derecho** (`captureTabConfig`: documento, género, arranque,
  modo del buró, «cupo ya confirmado», los estados y valores de cada buró). Una pestaña NUEVA arranca con la
  configuración por defecto (`defaultTabConfig`: los `value` del marcado vía `defaultValue`, no lo tipeado, y los
  burós respondiendo); la identidad queda vacía y se genera en la corrida. ⚠ La vista «Comercio» NO es de la
  pestaña: escribe `allieds` y vale para el comercio entero.
- **El Admin dejó el selector del centro y es un apartado del sidebar izquierdo** (`#adminRow`, debajo de los
  comercios): abre la pestaña Admin del ambiente (una por juego), que muestra la PC de siempre. `#viewAdmin` sigue en
  el DOM, oculto, porque `showStageView` lo usa; `showStageView('admin')` (también el que restaura la vista al
  arrancar) ahora abre esa pestaña. Con Admin activa, el comercio elegido deja de verse elegido (`data-admin-on`).
- ⚠ **Dos cosas que le ganaban a la pestaña elegida, medidas en la corrida**: la ruta que se restaura al abrir el panel
  (`tabsFollow` no corre hasta `tabsBoot`), y las reescrituras de ruta que llegan solas después (los canales, la
  sugerencia), que sacaban de Admin aunque nadie eligiera un comercio (`followKey`: con Admin activa sólo se sigue
  si cambió el comercio o el canal).
- Verificado el 2026-10-20 en un panel de prueba en local: el juego viejo migró a local; pestaña nueva con valores por
  defecto (2.000.000 · score 700 · M) mientras la de Pullman volvía con los suyos (1.500.000 · 450 · F); juegos
  separados local/qa (qa simulado: sin VPN de dev el botón está apagado); la pestaña Admin desde la barra, una sola
  por juego, y de vuelta a una corrida. ⚠ No se probó recargar con Admin activa de punta a punta: recargar abre la PC
  del admin local de verdad, y eso levanta `artisan serve`; el camino se probó sin recargar.

### «Agregar comercio» con el catálogo del ambiente, y el asesor de prueba (2026-10-20)

- **La barra sigue siendo tuya** (curados + agregados): el catálogo entero NO se vuelca ahí. Al enfocar el buscador
  (o «Agregar comercio…») aparece el **catálogo del ambiente** (`/api/catalog` → `dbops catalog` →
  `listCatalog` en `pkg/merchants.ts`): todos los comercios con sucursal activa, filtrados mientras escribís, sin
  una consulta por tecla. Medido en local: **244 comercios, 11 con asesor de prueba**, que van primero y dicen
  «prueba». dev, qa y staging comparten base: se cachea por BASE (5 min; un fallo de lectura no se guarda). Sin
  catálogo (sin VPN) se cae a la búsqueda de siempre.
- **La sucursal por defecto es la del asesor de prueba** (`test_branch`: la de `c<hash>-fake@`, que el alta deja en
  `b<hash>-fake`), marcada «la del asesor de prueba» en el selector. ⚠ Esa sucursal puede no tener entidades (la de
  Alta Fleet en local: 0): el ⚠ de la fila y el comando `bin/pg admin branch-lenders` siguen siendo el aviso.
- **«Crear asesor de prueba»** (en el alta, si el comercio no lo tiene, y en la pregunta del canal fuera de local) va
  por `POST /api/test-advisor` → `bin/pg admin test-advisor`: primero la vista previa del conector (dice CON QUIÉN
  actúa), después, confirmado, `--apply`. Fuera de local el aviso dice que es la base COMPARTIDA. qa usa el admin de
  dev; producción no está. Si el conector contesta «no hay nada que crear», sólo se refresca.
- **Elegir una sucursal del catálogo abre una pestaña en vista previa que pregunta el canal** (`sel.adhoc` en
  `tabsFollow`): el canal que trae la ruta en ese momento es la SUGERENCIA del servidor, no una elección. Si después
  la agregás, la pestaña pasa del hash al slug nuevo.
- Verificado el 2026-10-20 en un panel de prueba en local: el catálogo (244 · 11), «+vida» sin asesor → el botón y
  la vista previa del conector (se canceló: no se creó nada), Alta Fleet con su sucursal de prueba preseleccionada,
  su pestaña preguntando el canal y, elegido Asesor, de ida y vuelta entre pestañas. «Agregar» no se probó para no
  escribir en tu `.flows.json`.

### El modo «prod · sólo mirar» (2026-10-20)

El menú de ambiente lleva `prod · sólo mirar`. **No es un `target`, a propósito**: si lo fuera, cualquier camino que
escribe por ambiente (asignar el asesor, sembrar, el bypass del OTP, los flags del comercio) lo tomaría como uno más, y
el servidor además cae a `local` con un target que no conoce. Es un MODO (`prodMode`): `target` se queda en el
ambiente de antes y lo único que el panel le pide a prod son `/api/prod/catalog` y `/api/prod/merchant`
(`pkg/prod-catalog.ts`), que leen por el conector (`bin/pg sql --target prod`, Redash con usuario de sólo lectura).

- **La barra lista el catálogo de prod** (`#prodList`) en vez de tus comercios, filtrado por el mismo buscador; los
  que tienen asesor de prueba van primero. **Elegir uno abre su FICHA** en una pestaña del juego `prod` (vista previa,
  como en los otros): sucursales, asesor de prueba y si su cuenta de Cognito está enlazada, su sucursal falsa y las
  entidades de esa sucursal, con los avisos (sin asesor, sin `cognito_id`, sucursal apagada o sin entidades).
- **Apagado mientras dura**: el sidebar derecho (sus fieldsets, guardando cómo estaba cada uno: los flags del
  comercio ya vienen apagados fuera de local), «Corrida» del pie (`updateGo`), la franja del plan y su play, y los
  celulares (el centro muestra fichas). La corrida que sí se permite en prod sigue en la vista «Prod».
- **Se sale eligiendo otro ambiente** con su botón real: `exitProdMode` corre antes que `switchTabSet` (que no corre
  en modo prod) y éste trae el juego del ambiente. No se recuerda al recargar: el panel arranca en su ambiente.
- ⚠ **Medido el 2026-10-20**: la consulta del catálogo de local no termina en 60 s en prod (una subconsulta por
  comercio sobre `users`). Partida en dos son ~2 s cada una, pero por la cola de Redash el catálogo tardó ~15 s la
  primera vez: se cachea 10 min. Prod: **339 comercios con sucursal activa, 27 con asesor de prueba**. Sonría (#26):
  `cd6b88e5e-fake@`, sucursal `d6b88e5e`, 12 de 12 entidades encendidas. Alkosto (#209): sin asesor de prueba.
- Verificado en un panel de prueba: entrar por el menú real, filtrar, abrir fichas, salir con el botón de local
  (las 7 pestañas de local de vuelta y los fieldsets como estaban), y en la red sólo `/api/prod/*` mientras duró.
