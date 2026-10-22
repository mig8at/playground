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

> ⏩ **Histórico.** Desde el 2026-10-21 la barra sale del registro `harness.json` y el buscador sólo la filtra: ver
> «Un solo registro de comercios, y se agregan por consola» al final.

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

⚠ **Desde el 2026-10-21 el plan NO está en la interfaz** (pedido de Miguel): se quitaron la franja `#planBar`, «Paso a
paso» y su lógica de `index.html`. Siguen `pkg/run-plan.ts`, `bin/plan.ts` (`make harness-plan`) y `/api/plan` en el
servidor, pero nadie los lee desde el panel. Lo de abajo describe cómo era.

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
- **El canal de la pestaña activa se MUESTRA en el pie** (`#btnChannel`, un texto al lado de `#caseTitle`, que ya no lo
  repite). No es un menú: el canal se elige al crear la pestaña y queda con ella. Desde el 2026-10-21 no va en el nombre de la pestaña (queda en el tooltip; Admin y
  prod siguen mostrando su ambiente) ni como fila del sidebar derecho: tres lugares para lo mismo era ruido.
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

> ⏩ **Reemplazado el 2026-10-21**: agregar es por consola (`make harness-merchants`). Queda «Crear asesor de prueba» al
> elegir el canal.

- **La barra sigue siendo tuya** (curados + agregados): el catálogo entero NO se vuelca ahí. Al enfocar el buscador
  (o «Agregar comercio…») aparece el **catálogo del ambiente** (`/api/catalog` → `dbops catalog` →
  `listCatalog` en `pkg/merchants.ts`): todos los comercios con sucursal activa, filtrados mientras escribís, sin
  una consulta por tecla. Medido en local: **244 comercios, 11 con asesor de prueba**, que van primero y dicen
  «prueba». dev, qa y staging comparten base: se cachea por BASE (5 min; un fallo de lectura no se guarda). Sin
  catálogo (sin VPN) se cae a la búsqueda de siempre.
- **La sucursal por defecto es la del asesor de prueba** (`test_branch`: la de `c<hash>-fake@`, que el alta deja en
  `b<hash>-fake`), marcada «la del asesor de prueba» en el selector. ⚠ Esa sucursal puede no tener entidades (la de
  Alta Fleet en local: 0): el ⚠ de la fila y el comando `bin/pg admin branch-lenders` siguen siendo el aviso.
- **Sin asesor de prueba (fuera de local), la pregunta del canal NO muestra los canales** (2026-10-21): sólo «Crear
  asesor de prueba» y el motivo en `#tabStartDesc`. `createTestAdvisor` espera la nueva medición del ambiente
  (`await enrichMerchants()`) y la pregunta vuelve a dibujarse ya con los canales.
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

### La barra es LA MISMA en todos los ambientes, también en prod (2026-10-20)

Los curados y los que agregaste salen en local, en la compartida y en prod; donde un comercio no existe, sale apagado
(«No están en qa», «No están en prod»). En prod la barra dejó de ser el catálogo entero: son tus comercios contra prod,
y al buscar aparece «Agregar desde prod» con los que coinciden y todavía no están.

- **El mismo comercio en otra base se reconoce por `allieds.slug`**, porque el hash de la sucursal es otro en cada base.
  ⚠ La clave de un AGREGADO sale del nombre que le pusiste («smart») y no matchea con nada: por eso al agregar se guarda
  `allied_slug` y el rescate de `/api/branches` busca por él. Medido el 2026-10-20: 27 de las 30 entradas de
  `.flows.json` están en prod con el mismo slug (y el mismo id); las 3 que no, son comercios de prueba de las bases de
  desarrollo (CeluRD Test, Comercio pruebas Perú, Alta Fleet).
- ⚠ **Mostrarlo no alcanza: hay que CORRER contra la sucursal de esa base.** El panel y `bin/advisor` corren contra
  `por_target[target] ?? branch_hash`, y el rescate sólo arreglaba lo que se veía. Por eso al agregar,
  `branchesAcrossBases` resuelve su sucursal en local, en la compartida y en prod (la del asesor de prueba si la hay) y
  la deja en `por_target`; en la base donde lo agregaste manda la sucursal que ELEGISTE (en local se corre contra la
  elegida). Si una base no contesta (sin VPN), la primera vez que `/api/branches` lo encuentra ahí por su slug guarda esa
  sucursal en `por_target` (sólo para agregados: los curados se declaran a mano), como hace `bin/advisor` al resolver.
- Verificado con copia y restauración de `.flows.json`: agregar «Refrigeración Wonder» desde prod lo dejó con
  `por_target {local, prod}` (la compartida no contestaba: sin VPN de dev); un agregado con un hash inexistente y su
  `allied_slug` se encontró en local y dejó `por_target.local`, y la lectura siguiente ya lo trajo como declarado
  (4 entidades). La compartida NO se probó.

### Sin selector de vistas en el editor; la corrida pública es una pestaña del modo prod (2026-10-20)

`Originación · Prod` ya no se ve arriba del editor: con las pestañas, el centro lo decide la pestaña activa (una
corrida → celulares, Admin → la PC, una ficha de prod → la ficha). `#stageViews` sigue en el DOM, oculto, porque
`showStageView` lo usa. **La corrida pública de prod es un apartado de la barra en modo prod** («Corrida pública de
prod», arriba de los comercios) y abre su pestaña (`kind: 'prodrun'`, una por juego) con la tarjeta de siempre
(`#prodView`). Fuera del modo prod esa vista no se abre (ni por la preferencia guardada); al salir del modo, el centro
vuelve a la pestaña del ambiente.

⛔ **En prod el panel NO entra ni maneja: abre el celular y la persona entra A MANO** (ver «El celular en prod, a
mano»). Automatizar el login del asesor de prueba en prod —aunque la clave sea la compartida— se pidió el 2026-10-20 y
se dejó afuera: es entrar con contraseña a producción, el primer ingreso puede completar el `cognito_id`, y desde ahí
las centrales y las entidades son reales.

### La ficha de prod deja lo necesario para entrar A MANO (2026-10-20)

Con asesor de prueba, la ficha muestra «Para iniciarla desde tu navegador»: la URL de entrada del canal asesor en la
sucursal falsa (`https://originaciones.creditop.com/merchant/<hash>/solicitar`, de `PROD_FRONT`), el correo del asesor
y «Copiar contraseña». El panel NO entra: es para que la persona lo abra en su navegador.

- ⚠ **La contraseña nunca se escribe en la página.** El botón la pide a `POST /api/prod/advisor-password`, que lee
  `ALLIED_TEST_ADVISOR_PASSWORD` de `harness/.env.prod`, y va directo al portapapeles. La ruta exige JSON (un sitio de
  otro origen no puede mandarlo sin CORS, que el panel no habilita) y el panel escucha sólo en la interfaz local.
- Verificado en un panel de prueba: Sonría muestra la URL de `d6b88e5e` y `cd6b88e5e-fake@`; la ruta contesta (se
  comprobó sólo que llega y su largo) y sin JSON da 415; el valor no aparece en el DOM.

### Una consola por pestaña (2026-10-20)

`RUN_LOG` sigue siendo UNA consola, pero ya no se pierde al pisarla: `freshConsole` (los tres lugares que arrancan una
consola nueva: abrir un celular, lanzar, la corrida de prod) guarda la anterior en `.runs/consoles/<id>.log` y le da a
la nueva un id nuevo, que vive en `RUN_LOG.id` para sobrevivir a reiniciar el panel. Se guardan las últimas 200.
`/api/status` dice cuál es la viva (`consoleId`) y `/api/console?id=` sirve cualquiera.

- **La pestaña que arranca la corrida la anota** (`claimConsole`, desde `claimDevices` y `launch`): `noteConsole`
  guarda en `t.consoles` los ids que nacen DESPUÉS de reclamarla (el id lleva la hora: una consola vieja que el poll
  todavía reporta no se le atribuye a nadie).
- **Al mirar otra pestaña se pinta la suya** (`syncConsoleView`): su última consola guardada, con «la de esta pestaña
  · hora» en la banda; nada y «esta pestaña todavía no corrió» si no tiene; la viva si es la dueña. Mientras tanto la
  viva se sigue juntando en `logLines` y vuelve entera al volver. Admin y prod muestran la viva.
- ⚠ **`copiar` copia la que estás mirando** (más el SSR, que es uno solo).
- Verificado en un panel de prueba en local, con celulares de verdad: Pullman · Asesor y después Sonría · Asesor
  quedaron con su consola cada una; volver a Pullman mostró la suya guardada (11 líneas, «▶ CELULARES · pullman…»), a
  Sonría la viva (12), y Motai «esta pestaña todavía no corrió».

### El celular en prod, a mano, y la ficha en el sidebar derecho (2026-10-20)

En modo prod, la pestaña de un comercio muestra «Abrir el celular» y, abierto, el celular del asesor en la entrada del
canal asesor de su sucursal falsa (`POST /api/prod/phone`; la URL la resuelve el servidor con `prodMerchant`, no la
manda la página). La persona entra (correo y «Copiar contraseña» en la ficha) y maneja.

- ⛔ **A ese celular no se le engancha NADA** de lo que tienen los otros: ni sesión guardada, ni autorrelleno, ni bypass
  del OTP, ni aprobar identidad, ni cuota inicial, ni traspaso al cliente, ni `rememberDevice` (su sesión sería la de
  prod; verificado: `.runs/devices-state.json` no la tiene). `prodPhones` marca el celular y el servidor NIEGA
  `advance`, `advance-all`, `tap`, `saved` y `resume` mientras lo sea; los botones de avanzar se ocultan. Abrir otra
  cosa en ese celular (`releaseDevice`) lo desmarca.
- **La ficha pasó al sidebar derecho** (`#prodRightNote` → `.prod-side`): en prod el sidebar derecho ya no muestra la
  configuración del caso apagada, muestra la ficha (sucursales, asesor de prueba, cómo entrar, sus entidades) con cada
  rótulo arriba de su valor, porque en dos columnas el valor quedaba en 8 caracteres.
- El celular es de UNA pestaña a la vez, también entre ambientes: abrirlo en prod con otro abierto pide cerrar el otro.
- ⚠ El traspaso al celular del cliente no corre en prod: si el flujo pasa al cliente, ese link se abre a mano.
- Verificado en un panel de prueba: el celular abrió en `login.creditop.com` (el login de prod) y no se escribió nada
  en él; `advance` contestó «es un celular de prod: lo manejás vos…».

### El registro de comercios por BASE (`.flows.json` versión 2, 2026-10-21)

> ⏩ El archivo ahora es `harness.json` (versionado), con el mismo formato y tres campos más: ver al final.

`.flows.json` pasó a tener el COMERCIO arriba y las BASES adentro, con las claves en inglés. Todo lo lee y lo escribe
`pkg/flows.ts` (en bash, `bin/flows.ts`; `make harness-flows`):

    { "version": 2, "otp_bypass_phone": "3131010101",
      "merchants": { "sonria": { "name": "Sonría", "allied_slug": "sonria", "channels": ["asesor"], "favorite": true,
                                 "bases": { "local": { "branch": "f581714b" }, "shared": { "branch": "44ed36af" },
                                            "prod": { "branch": "d6b88e5e" } } } } }

- **Por base y no por ambiente**: dev, qa y staging comparten base (`shared`); repetir su sucursal tres veces era
  invitar a que diverjan. Lo que sí es por AMBIENTE son las pestañas (estado de la interfaz, en `localStorage`).
- ⚠ **El formato viejo se sigue leyendo** (`branch_hash` + `por_target`, `fav`, `canales`): hay comandos guardados en
  las tareas y otras sesiones con archivos viejos. `branch_hash` valía para todas las bases salvo `por_target`, así que
  pasa a `local` y `shared`. La primera ESCRITURA de un archivo viejo deja `.flows.json.v1.bak`.
- **Lo usan**: el panel, `bin/advisor` (la sucursal y el teléfono de bypass, y el cacheo de un comercio resuelto, ahora
  en la base de ESE ambiente), `bin/seed-code`, `pkg/autofill.ts`, `pkg/preflight-branch.ts`, `dev/sweep.ts`,
  `dev/mount-merchant.ts`, `dev/mount-peru.ts` y `dev/autofill-probe.spec.ts`. Si agregás un lector, va por el módulo.
- ⚠ **Un panel arrancado con el código de antes NO entiende el formato nuevo**: migrar el archivo con ese panel vivo le
  deja la barra sin sucursales. Primero se reinicia el panel; después `make harness-flows A=migrate` (o se convierte
  solo con el primer «Agregar»).
- `HARNESS_FLOWS_FILE` apunta a otro registro: así se probó sin tocar el de la máquina.
- Verificado el 2026-10-21: las 124 combinaciones (31 comercios × local/dev/qa/staging) dan la misma sucursal antes y
  después de migrar una copia, sin claves viejas y con su `.v1.bak`; `preflight-branch.spec.ts` 11/11; el panel de
  prueba contra la copia migrada: barra, `/api/branches` (Perú: `50e007e4` en local, `a8221e67` en qa), canales
  declarados de Refurbi, y agregar · renombrar · quitar (los curados siguen sin poder quitarse).

### ⏩ La corrida completa: en el SERVIDOR, no en la interfaz (2026-10-21)

⚠ **El botón «Corrida completa» de la franja del plan se quitó el mismo día** (pedido de Miguel): el panel es para mirar
paso a paso, y de punta a punta ya se corre de varias formas por consola. Queda el servidor, que es lo que usan los
agentes para manejar los celulares del panel: `/api/device/<id>/advance-all` con `{lender, follow}` y `GET /api/autorun`.
Un plan con `play: "auto"` en el panel va paso a paso, y la franja lo dice.

- **`advanceAll` sabe dos cosas más, y son de la CORRIDA**: con `lender`, en `/lenders` elige ESA entidad con
  `chooseEntity` (`pkg/wizard-browser.ts`, vía `deviceChooseEntity`), que abre las tarjetas que se despliegan; con
  `follow`, cuando el asesor llega a `…/{ur}/continue|confirmation` espera a que `watchAdvisorHandoffs` abra el cliente y
  sigue ahí. La entidad del plan puede ser id o nombre: el servidor la pasa a nombre (`dbops lender-rt`).
- ⚠ **Si la entidad no está en el listado, PARA y dice cuáles había**: elegir otra en silencio es justo lo que tiene
  que saltar a la vista (F-162). Medido: «NoExisteEnElListado» en Pullman paró con «Se veía: Creditop isotype · Validar
  Pre aprobado · Bancolombia - Compra y paga después · … · Sistecrédito … Activar mi crédito» (CrediPullman sale con el
  `alt` de su logo).
- **El servidor dice si sigue** (`GET /api/autorun`: activa, en qué celular va, por qué terminó). No se
  infiere por silencio: durante el traspaso ningún celular avanza hasta ~90 s. «Detener» corta también esa espera
  (`followCancelledAt`).
- ⚠ **El motivo de una corrida trabada es lo que MUESTRA la pantalla** (`screenError`), no «locator.click: Timeout»: un
  modal de error tapa el botón y el toque tira.
- Verificado en local (panel de prueba, plan Pullman · CrediPullman): el asesor avanzó solo, eligió CrediPullman, el
  traspaso abrió el cliente y éste siguió hasta la firma; paró con «se trabó en …/sign-documents: la pantalla dice
  «Error al cargar los documentos»» (los PDF del pagaré, consentimiento y garantía no están en el S3 local: es del
  ambiente, ver skill `harness-local`). En la base, las solicitudes 467488 y 467489 quedaron en estado 10 con la
  entidad 77. El canal ecommerce NO se probó con la corrida completa.

### Dos pestañas a la vez: los CARRILES (2026-10-21)

⚠ **Desde el mismo día son N, no dos** (ver «N carriles» más abajo). Lo que sigue describe el mecanismo, que es el mismo.

Dos pestañas pueden correr al mismo tiempo, cada una con su par de celulares. El carril A son los de siempre
(`advisor`, `client`) y el B los mismos con `-b` (`advisor-b`, `client-b`, `Lane`/`laneOf`/`roleOf`/`inLane` en
`panel/devices.ts`). Casi todo el servidor ya iba por id de celular, así que un carril es un id más; lo que no:

- **Una consola viva por carril** (`RUN_LOGS.b` = el log con `-b`, `consoleIds[lane]`, `?lane=b` en `/api/status`,
  `/api/log` y `/api/autorun`). Lo que el panel anota va a la del carril del celular (`panelOf(id)`). Las corridas por
  `bin/advisor` y la de prod son del A.
- **El traspaso y la corrida completa siguen al cliente DE SU carril** (`watchAdvisorHandoffs(…, advisor)`, el `follow`
  de `advanceAll`); `autoRuns`, `lastAdvanceWhy` y `followCancelledAt` son por carril.
- ⚠ **Cada carril tiene su celular sintético**: A `3131010101`, B `3131010102`. Con el mismo número, abrir una corrida
  limpiaba (scrub) al cliente de la otra con sus solicitudes. El del B no está en `qa_otp_bypass_phones`: el servidor lo
  suma al abrir el asesor (`otp-bypass-add`) y lo saca al cerrarlo.
- **En la interfaz las pantallas son las mismas dos**; cambia de qué carril son (`phoneLane`). `D(rol)` es el celular
  del servidor de ese rol en el carril que se ve, y toda llamada a `/api/device/…` pasa por ahí (la PC del admin no).
  `setPhoneLane` corta la transmisión del carril anterior, cambia el celular del caso, retoma los celulares del nuevo y
  empieza a leer su consola.
- **Quién usa qué carril** (`laneOwners`, `claimDevices`): el que ya tiene la pestaña; si no, uno libre (el A primero);
  con los dos ocupados, el aviso «Los dos carriles están ocupados» y abrir pide cerrar la del A. `pollLanes` pregunta al
  servidor cada 3 s qué hay abierto en cada uno. Prod va siempre por el A.
- ⛔ **El mismo comercio en OTRA sucursal, en local, no puede ir al otro carril**: su asesor de prueba es uno y está en
  una sola sucursal; abrir la segunda lo movería y la primera seguiría contra la sucursal equivocada. `claimDevices` lo
  frena con un aviso. Con la misma sucursal sí se puede.
- ⚠ **Y cada carril tiene su IDENTIDAD sintética** (`laneCase`): sin cédula en el caso, el B va con `1096734491` y
  `qa.harness+b@creditop.com`, no con las del autorrelleno (`1096734490`, `qa.harness@`). En la base compartida la misma
  cédula con dos celulares trababa al segundo en la confirmación de identidad (qa, 2026-10-21); en local no se veía porque
  cada corrida limpia su cliente. Fuera de local el A también lleva su cédula explícita, para que se le DICTE a la lambda
  y no conteste la identidad por defecto (con ella el listado de qa salía vacío).
- ⚠ **El carril se elige con el estado del servidor de AHORA** (`claimDevices` llama a `pollLanes`): con el de la
  última consulta, Mediarte abrió en el carril A y cerró la corrida de Pullman (qa, 2026-10-21).
- ⚠ **El traspaso le pasa el celular a `rescueIdentity`**: fuera de local sólo aprueba la identidad con él, y sin él el
  cliente se quedaba en la selfie. Pasaba también antes de los carriles.
- Verificado el 2026-10-21 en local, a la vez: Pullman · Asesor (carril A, CrediPullman) y Mediarte · Asesor (carril
  B, Mediarte X, con su asesor entrando por el login del conector) llegaron solos a `loan-approved`; en la base, 467492
  (Pullman, `…0101`) y 467493 (Mediarte, `…0102`), las dos en estado 11 con desembolso; ninguna consola menciona el
  comercio de la otra. Al cambiar de pestaña cada una muestra su carril, su celular del caso y su consola; una tercera
  pestaña ve «Los dos carriles están ocupados»; el freno de la misma sucursal se probó simulando el estado de los
  carriles. NO se probó el carril B por la tienda.
- **En la compartida (qa), el 2026-10-21**: los dos carriles corrieron a la vez, cada uno con su asesor de prueba en la
  sucursal falsa (`036610aa`), su celular, su cédula y su consola, y los dos pasaron el OTP. Ninguno cerró, por cosas de
  qa y no de los carriles: (1) el listado de CrediPullman salió vacío o no según la corrida, con la misma cédula
  («No encontramos una opción para ti»); (2) con la identidad aprobada a mano, el wizard igual mandó al cliente a la
  selfie (`identity-validation`); (3) Mediarte valida el OTP por onboarding v2 (`ValidateOtpAuthController` →
  `/api/otp/validate`), que no respeta el bypass que sí usa el envío: con un número del bypass el OTP sale
  `CODE_INVALID` (le pasaría igual en el carril A).

### El OTP en la compartida: el panel lo lee del SERVICIO DE OTP (2026-10-21)

En dev, qa y staging el panel ya no usa el bypass (`qa_otp_bypass_phones`): con él el código no llega al proveedor y
los comercios del pipeline de KYC (onboarding v2) no pasan el OTP (F-243). En cambio:

- **Los celulares del caso fuera de local son otros, FUERA del bypass**: A `3131010103`, B `3131010104` (`laneCase` en
  el servidor; `lanePhone` en la interfaz). Si la pestaña trae uno de los de local o ninguno, se reemplaza, y con él
  **la cédula y el correo, siempre** (A `1096734493`, B `1096734494`, `qa.harness+<últimos 4>@`): en la compartida la
  cédula queda atada al celular con que se registró, y la que guardaba la pestaña (`1096734491`, atada al `…0102`) dejó
  al B en un usuario `TEMP-…` trabado en personal-info.
- **`otpFromService`** (servidor) mira la pantalla del celular después de abrirlo, del traspaso y de retomarlo; cuando
  hay un campo de OTP, espera un código GENERADO DESPUÉS de esa pantalla (`waitForOtp` en `pkg/otp-service.ts`: `POST
  /api/otp/latest` y `/api/otp/decrypt` del servicio, `otp-service.inertia-develop:8083`, con la VPN de dev y sin
  autenticación) y lo escribe con `deviceFillOtp`. La consola dice «◆ OTP del servicio de OTP (el mismo de
  #qa-messages)». Es el mismo código que una persona copia de Slack. ⚠ Sólo de los teléfonos del panel.
- El chip del cliente dice «código del servicio» fuera de local; en local sigue siendo el del bypass.
- **Medido en qa el 2026-10-21, los dos carriles a la vez**: Pullman (B, `…0104`, CrediPullman) llegó solo a
  `loan-approved` (503879), con los dos OTP —registro y firma— leídos del servicio. Mediarte (A, `…0103`, Mediarte X)
  pasó el OTP v2 y se quedó en `kyc-processing` → «No pudimos verificar tu información» (503878): la corrida del
  pipeline pidió `expedition_date` y quedó CERRADA (`run_open:false`, `PENDING_USER_DATA`); al guardar personal-info el
  wizard pidió arrancar otra y el backend no recibió ningún `kyc-requirements` nuevo. Es del pipeline de qa, no del
  panel ni del OTP: no está diagnosticado.

**Mediarte en qa: lo que se arregló del lado del panel, y lo que no (2026-10-21).** En `advanceAll` y `laneCase`:
- **Espera de 30 s antes de guardar personal-info** (sin `resume=1`), contados desde que el celular llegó a
  `kyc-processing`. Si igual aparece «No pudimos verificar tu información», espera la ventana del wizard (hasta 30
  esperas en esa pantalla) y toca «Intentar nuevamente» UNA vez. Ver F-244. El tope de pasos pasó de 40 a 80.
- **Una cédula nueva por corrida en la compartida** (`10` + 7 dígitos de la hora + carril), porque el guardado v2 de
  datos personales acepta 4 por cédula y por hora (`OBV21009`).
- **El nombre dictado es el que teclea el autorrelleno** (`envData`: CARLOS RAMIREZ), no «CLIENTE PRUEBA».
- **Se dicta de nuevo** antes de guardar personal-info y antes de reintentar.
- Lo que sigue sin cerrar: la central que consulta el pipeline puede caer en otro contenedor de la lambda y contestar
  la persona por defecto (F-245). Corrida 503897: OTP, espera, dictado y arranque bien; Ágil Data contestó
  `JUAN CARLOS PEREZ GOMEZ` y la identidad no coincidió tras tres correcciones.

**Mediarte por el pipeline de KYC en LOCAL cierra solo (2026-10-21, 467496 en estado 11).** Con `make harness-pipeline
PIPELINE_ALLIED=91` arriba (Temporal, el servicio de perfilamiento y kyc-gateway contra el mock `:8105`; agrega el
comercio a `kyc_pipeline_allieds`), el panel corre OTP v2 → kyc-processing → personal-info (espera los 30 s) → la corrida
completa → listado → Mediarte X → traspaso → firma → `loan-approved`, en 87 s. Lo que hizo falta:
- **En local el carril A también lleva cédula** (`1096734490`, la del autorrelleno), y el dictado al mock lleva el
  NOMBRE que se teclea (`BureauAnswer.name` en `pkg/risk-lambda.ts`). Sin eso el mock contestaba CARLOS RUIZ MENDOZA.
- **La espera de 30 s vale también en local**: el servicio de perfilamiento local tiene el mismo límite.
- ⚠ **Los mocks los levanta el panel de :5195.** Si la app lo detiene, se caen pdf-mapper (`:8100`) y los formularios
  (`:8101`, `:8109`), y la firma falla con «Ha ocurrido un error inesperado» (`pdf-mapper-service connection failure`).
- ⚠ **El correo del autorrelleno puede estar tomado por otra corrida** (`OBV21003`, «The email is already in use»,
  HTTP 422 al guardar personal-info, y el panel sólo ve que «Continuar» no avanza). La razón está en
  `/tmp/asesor-wizard.log` (`[PostHog log] error POST …/personal-info…`), porque sin Loki local el backend no deja
  nada. Se evita con cédula y correo propios en el caso.

### Los celulares miden el ALTO del editor, y la carcasa escala (2026-10-21)

`--phone-h` es todo el alto que deja `.devices` (menos el rótulo y 20 px abajo, que cubren la barra de scroll), sin
tope por ancho ni los 760 px de antes: si los teléfonos no entran a lo ancho, `.devices` scrollea de costado
(`overflow-x: auto`). ⚠ Va con `justify-content: safe center`: con `center` a secas el desborde se reparte a los dos
lados y el celular de la izquierda queda cortado sin forma de llegar a él. La carcasa es proporción del alto (`--bezel`
= 1,35 %, mínimo 4 px; esquinas 4,9 %; muesca 2,4 %): a 740 px son los 10 · 36 · 18 px de antes. Medido: con 358 px
de alto, teléfono de 310 y borde de 4; con 912, teléfono de 864 y borde de 11,5; a 760 px de ancho no se achica y
scrollea (935 de contenido en 428).

### Los canales y las ENTIDADES de la barra se PRECARGAN (2026-10-21)

Al medir el ambiente (`enrichMerchants`), `preloadChannels` pide `/api/canales` de todos los comercios de la barra que
están en ese ambiente, de a tres, y los guarda en `channelCache` (por ambiente y comercio). `loadChannels` lee de ahí, y
`loadLenders` lo llama PRIMERO (`await`): antes corría después de `/api/lenders` y `/api/pa-statuses`, y la pestaña
nueva decía «midiendo» ~300 ms en local aunque los canales ya estuvieran. Va antes y no en paralelo porque puede cambiar
el canal (el sugerido), que es con el que se piden las entidades. En el servidor, `measureChannels` guarda 5 min la
medición (Corbeta, auto-onboarding, autogestión) por ambiente y sucursal y comparte los pedidos simultáneos; lo
declarado en `.flows.json` se lee en cada pedido. Lo que no se pudo medir no se guarda en ninguno de los dos lados.
Medido: elegir un comercio deja sus canales en 7 ms en local y en 11–14 ms en qa (antes ~300 ms y segundos); la
precarga de qa, 12 comercios, tarda 8,6 s en segundo plano. ⚠ Un cambio de Corbeta o de auto-onboarding en la base
tarda hasta 5 min en verse (o reiniciar el panel).

**Las entidades van en la misma precarga** (`preloadMerchantData`, que reemplazó a `preloadChannels`): después de los
canales de cada comercio, `fetchLenders` pide sus entidades y las guarda en `lenderCache`. La clave es ambiente ·
comercio · si el canal es asesor o no, porque fuera de local el asesor mira la sucursal FALSA del comercio y el resto la
declarada (en local son la misma: una sola consulta; fuera, las dos). `loadLenders` lee de ahí y se queda con una COPIA
(`structuredClone`): la lista se modifica en el lugar al prender una entidad. Prender, apagar o reordenar desde el panel
llama a `forgetLenders(slug)`, y una consulta que falló no se guarda. Medido: entidades listas en 12 ms en local
(antes ~300) y en 13–25 ms en qa, sin pedir nada a `/api/lenders` al elegir; la precarga de qa (12 comercios, 24
consultas de entidades) termina en unos 20 s en segundo plano. ⚠ Lo que cambie en la base por FUERA del panel (otra
persona, el admin) no se ve hasta recargar la página.

### ▶ en el celular: Iniciar, y Reiniciar si ya corrió (2026-10-21)

La columna de botones de cada celular lleva arriba un `.device-play`. Va en el celular por el que ENTRA el canal de la
pestaña (`entryPhone`): el del asesor por asesor (`playMerchant`) y el del cliente por la tienda (ecommerce y auto, lo
mismo que «Pagar con Creditop»). Autogestión y QR no se abren desde los celulares, así que ahí no aparece. Con el celular
apagado dice ▶ «Iniciar»; si ya corrió algo (también el cliente del traspaso, por asesor) dice ↺ «Reiniciar» (icono
`restart` = `rotate-ccw` de Lucide, agregado a `tools/ui/icons.json`), que vuelve a abrir desde el principio con el
mismo caso; por asesor cierra también el cliente de la corrida anterior. Mientras carga, apagado. `syncPlay()` lo
decide con `phoneModes` (lo anotan `setAdvisorMode` y `setClientMode`) y se llama también desde `renderStage` y
`applyChannel`. ⚠ La columna ya no se oculta entera (`hidden`): marca `data-live`, y sin algo abierto sólo se ve el ▶.
Verificado en local: Pullman · Asesor abrió en 2 s y pasó a «Reiniciar»; reiniciar volvió a abrir (otra sesión, `since`
nuevo) y apagó el botón mientras cargaba; Pullman · Tienda online mostró el ▶ en el cliente y abrió el checkout en 3 s.

**La fila del comercio, sin chips de canal, sin ▶ y sin ⚠ (2026-10-21).** Eran ruido: la pestaña pregunta el canal al
abrirla (con los que aplican) y el celular tiene su ▶. El motivo de un ⚠ sigue en el tooltip de la fila y en la línea
de abajo de la elegida (`chosenSubline`). Se fueron `CHANNEL_SHORT`, los estilos `.row-chips` y la opción `play` de
`openTab`. Las etiquetas del comercio (`loadMerchantTags`) se siguen pidiendo: agrupan por país.

### N carriles, a demanda (2026-10-21)

Los carriles dejaron de ser A y B fijos: `LANES` en `panel/devices.ts` sale de `HARNESS_LANES` (4 por defecto, de 1 a 8)
y cada pestaña que arranca toma el primero libre. Los ids son el rol con su letra (`advisor`, `advisor-b`, `client-c`…;
`laneOf`/`roleOf`/`inLane`/`laneIndex`/`isDeviceId`), y las rutas `/api/device/…` aceptan los de los carriles que existen
(uno de afuera da 404). El techo no es Chromium —todos los celulares son contextos del mismo navegador— sino el backend
local (6 workers de PHP) y la memoria.

- **Todo lo del carril sale de su número** (A = 0): el celular sintético (`localLanePhone`: `…0101`, `…0102`, `…0103`…;
  `sharedLanePhone` en la compartida: `…0103`, `…0104`, `…0105`…), la cédula de local (`1096734490 + i`), el correo
  (`qa.harness+<letra>@`) y la cédula nueva de la compartida (termina en `3 + i`). La interfaz calcula el mismo celular
  (`lanePhone`). En local, el de cada carril que no es el A se suma al bypass al abrir y se saca al cerrar.
- **Una consola por carril** (`RUN_LOGS`, `.runs/…-<letra>.log`), y `autoRuns`, `lastAdvanceWhy` y `followCancelledAt`
  por carril (`perLane`). `?lane=` acepta cualquiera que exista (`laneParam`).
- **`/api/lanes`**: los carriles del panel y cuáles tienen un celular abierto, en UNA consulta. `pollLanes` la pide cada 3 s
  (antes eran dos consultas por carril) y de ahí la interfaz toma `LANES`.
- **«Los N carriles están ocupados»** sale sólo con todos llenos, con una fila por carril: su corrida, «Ir» si es de este
  ambiente y «Cerrar». El freno del mismo comercio en otra sucursal (en local) se mira contra TODOS los carriles ocupados.
- **El navegador de reserva sólo en el carril A**: con N carriles, una reserva por celular serían hasta 16 Chromium
  esperando; los demás lo preparan al abrir (`warmDevice`).
- Verificado en local con `HARNESS_LANES=4`: cuatro asesores abiertos a la vez en 7 s (Pullman, Mediarte, Motai y Sonría,
  cada uno con su celular `…0101`–`…0104`, su cédula `…490`–`…493` y su consola, que sólo nombra a su comercio). Tres
  cerraron solos a la vez en 91 s en estado 11 con desembolso (467500, 467498, 467501); Sonría paró en el listado por la
  entidad elegida (Credifamilia: «No pudimos consultar esta entidad»), no por el carril. En la interfaz, con los cuatro
  ocupados, la pestaña nueva mostró el aviso con las cuatro filas; «Cerrar» en la D liberó el carril y el ▶ de Sonría lo
  tomó (celular `…0104`, abierto en 1 s). Al cerrar todo, el bypass local volvió a tener sólo `3131010101`.
- ⚠ **La tarjeta «esperando a la entidad» es del carril de la pestaña** (`/api/estado?lane=<el suyo>`; vacío si no tiene).
  Antes `/api/estado` tomaba el primer celular abierto de CUALQUIER carril y, sin ninguno, el volcado más nuevo de
  `.runs/ureq-*.json`, que es UNO para todos los paneles de la máquina: la 467499 del carril D salía en la pestaña de otro
  comercio, y en el panel de :5195. El volcado queda sólo para cuando no se pide carril (las corridas por consola), y
  `activateTab` refresca la tarjeta al cambiar de pestaña.

**La pestaña de prod ES el celular, sin tarjeta (2026-10-21).** Al activarla (`activateTab`, si el carril A está libre)
`openProdPhone` abre la entrada del canal asesor de su sucursal de prueba por `/api/prod/phone`, igual que antes el botón
«Abrir el celular», que se fue con su tarjeta (`#prodTabView`). Se ve sólo el celular del asesor (el del cliente se oculta:
en prod no hay traspaso), con el chip ámbar «prod» en su rótulo; el ▶ del celular abre o reinicia (`playPhone` →
`openProdPhone`). Con el carril A de otra corrida, el celular queda apagado con su ▶ (que pregunta si cierra la otra).
Lo demás no cambia: el servidor sigue negando avanzar y tocar ese celular. Verificado en un panel de prueba: Pullman en
prod abrió solo en `login.creditop.com` → `originaciones.creditop.com`, el ▶ pasó a «Reiniciar», `advance` contestó «es un
celular de prod…», y al volver a local reapareció el celular del cliente.

**En prod la pestaña también pregunta el CANAL (2026-10-21)**, con los mismos botones (`renderProdChannelChoice`). Se
abren a mano el **Asesor** (su login, en el celular del asesor) y la **Autogestión** (`/self-service/<sucursal de
prueba>/solicitar`, en el del cliente: la persona se registra con su celular y el OTP llega por SMS). **Tienda online y
Auto quedan apagados**: su pedido lo arma el panel escribiendo en la base (`dbops ecommerce-url`), y en prod no se
escribe; **QR** también, porque pide el código de compra de la caja de Corbeta. `/api/prod/phone` recibe `channel`, abre
UN celular de prod (cierra el otro) y le pone el mismo `prodPhones`: no se avanza ni se toca. La pestaña dice
«prod · <canal>» y el pie su canal. `selfServiceUrl` sale de `prodMerchant` (`pkg/prod-catalog.ts`). Verificado en un
panel de prueba: Sonría por autogestión abrió `originaciones.creditop.com/self-service/d6b88e5e/solicitar` en el
celular del cliente (sin completar nada; `advance` negado); Pullman por asesor abrió el login de prod en el del asesor.

**Autogestión también tiene su ▶ (2026-10-21)**, en el celular del cliente: la apertura del cliente
(`/api/device/client*/open` con `channel: 'autogestion'`) entra directo a `/self-service/<sucursal>/solicitar`, sin
pedido, con lo mismo que por la tienda (limpieza del celular, bypass en local u OTP del servicio en la compartida,
centrales, autorrelleno, identidad y cuota inicial a mano). Verificado en local: Sonría por autogestión llegó sola al
listado (467506), pasando el OTP y la espera del pipeline de KYC. Sólo el QR sigue sin ▶.

**El punto de la pestaña dice si hay una SOLICITUD en curso (2026-10-21).** Verde: el carril de la pestaña tiene una
solicitud, y el tooltip dice cuál y en qué pantalla («Solicitud #467507 en curso · personal-info · carril A»). Contorno
gris: los celulares están abiertos y todavía no hay solicitud (el monto, el login). La solicitud sale de `/api/lanes`
(`requests`), que la lee de la URL de los celulares del carril, el cliente primero. ⚠ El segmento tiene que ser ENTERO
y de 5 a 9 cifras: un hash de sucursal puede empezar con cinco cifras (`13874eb6` se leía como la solicitud 13874) y en
la pantalla del OTP el segmento es el celular, de 10.

### Con todos los carriles ocupados, se cierra el que más tiempo lleva sin usarse (2026-10-21)

Ya no se pregunta ni se cierra a mano: los carriles son de la MÁQUINA (todos los ambientes, prod incluido) y el tope es
`HARNESS_LANES`. Si una pestaña arranca y no hay carril libre, `claimDevices` toma el que lleva más tiempo sin usarse
(`/api/lanes` → `lastUsed`, el más reciente de sus dos celulares), lo cierra sin confirmar y le deja a su pestaña la nota
`evicted` («Se cerró para abrir «X»: llevaba N min sin usarse»), que se ve en su celular o en el aviso hasta que le des ▶.
- **«Usado»** lo anota `devices.ts` (`touchDevice`): al abrir, al cambiar de pantalla y con cada toque, tecla, «tocar» o
  «avanzar». Una corrida que avanza sola cambia de pantalla, así que cuenta como en uso.
- **El aviso de ocupados** dice cuál se va a cerrar y ofrece un solo «Iniciar» (sin filas ni «Cerrar» por carril).
- **El freno del mismo comercio en otra sucursal** (local) se mira ANTES de cerrar: si frena, no se pierde nada.
- **Prod ya no exige el carril A**: `/api/prod/phone` recibe `lane` y abre ahí, con el mismo `prodPhones`.
- Verificado con `HARNESS_LANES=2` en local: Pullman (A) y Mediarte (B) abiertos, Mediarte tocado; Motai mostró «Al iniciar
  se cierra … «Pullman · Asesor»», «Iniciar» lo abrió en A sin preguntar, Pullman quedó con su nota (también después de
  recargar) y Mediarte siguió en B. El celular de prod abrió en `advisor-b` y `advance` siguió negado.

### La barra izquierda como el Explorer de VS Code, y el pie sin el caso (2026-10-21)

- **Una vista por grupo** (`sideView`): cada país, «No están en <ambiente>» y Admin (en prod: «Corrida pública», «En prod»,
  «No están en prod», «Agregar desde prod»). Es el `.view` de la base: encabezado con chevron (`.view-tog`) y su cuenta,
  cuerpo con su propio scroll, y las abiertas se reparten el alto. **Ninguna cambia de lugar al plegarse**, como en VS Code:
  la cerrada queda como su fila donde estaba y las abiertas ocupan el resto (hasta el 2026-10-21 las cerradas se iban al
  final con `order: 1`; Miguel lo pidió fijo). Por defecto abierta sólo la primera (Colombia); lo demás, cerrado. Se recuerda en `harness.sideViews`. El Admin es una vista FIJA del marcado (`#adminView`): `renderMerchants` la
  saca antes de limpiar y la vuelve a poner al final, y su chevron se engancha una vez (`wireAdminView`).
- **El pie ya no lleva el comercio (`#caseTitle`), el canal (`#btnChannel`) ni el resumen del caso (`#caseDetails`)**:
  eran ruido, lo dicen la pestaña y el sidebar derecho. Se fueron con ellos `activeCaseSummary` y `CHANNEL_LABELS`.
- Verificado en el panel de :5195: Colombia abierta arriba y Perú, República Dominicana y Admin como filas al final;
  abrir Perú le dio la mitad del alto; Admin abierto mostró su fila; todo quedó igual después de recargar; en prod, las
  tres vistas con sus cuentas.

### La URL es la pestaña: `/<ambiente>/<comercio>/<canal>`, sin `#` (2026-10-21)

`/local/pullman/asesor` · `/qa/sonria` (pestaña que todavía pregunta el canal) · `/local/admin` · `/prod/pullman/asesor` ·
`/prod/corrida-publica`. El comercio es la clave de la BARRA, la misma en todos los ambientes: en prod se traduce al
comercio por su `allieds.slug` (`prodSlugOf`), porque el de prod puede llamarse distinto. La vista va de query y sólo si
no es la de por defecto (`?vista=buros`, `?consola=mocks`, `?inicio=entidades`).
- **La escribe la pestaña activa** (`routeUrl` desde `currentTab()`, no desde el comercio elegido), y `renderTabs` la
  sincroniza (`syncRouteNow`). `push` cuando cambia la pestaña, `replace` cuando sólo cambia la vista: atrás vuelve a la
  pestaña anterior.
- **Abrir una URL lleva a esa pestaña o la crea**: el ambiente por su botón (o el modo prod), después la pestaña
  (`activateTab`, o `openTab` si no existía; en prod espera el catálogo de Redash). `tabsBoot` corre ANTES que la primera
  `applyRoute`, para que la URL gane, y `restoring` arranca en `true`: si no, el `renderTabs` de `tabsBoot` escribía la
  URL de la pestaña guardada encima de la que se abrió.
- **Los enlaces viejos** (`#/pullman?canal=asesor&vista=buros`) se traducen al cargar a `/local/pullman/asesor?vista=buros`.
- **El servidor** devuelve la página para todo camino que empiece con un ambiente; `/api/…` mal escrito sigue en 404.
- Verificado en un panel de prueba: las cinco formas, el enlace viejo con su vista, atrás entre dos pestañas, y el cambio
  de ambiente (local → qa) y a prod (con el celular de prod abierto solo en su login). Una vez, cargando
  `/prod/corrida-publica`, la pestaña del navegador de prueba se cerró sola; repetido, cargó bien y sin errores.

### Prod con la misma forma que los demás ambientes (2026-10-21)

- **La barra de prod** ya no tiene sus secciones propias («Producción», «En prod», «Corrida pública»): es una vista por
  país con las MISMAS claves (`pais:Colombia`…, así abierta o cerrada vale en todos los ambientes), «No están en prod»,
  «Agregar comercio…» al final de la primera y **Admin** abajo. En prod su fila del admin va apagada con el motivo (el
  admin de producción no se abre desde el panel), y la **corrida pública** es una fila de ese Admin: es una herramienta
  del ambiente, no un comercio. Sin la marca «prueba» en las filas (el detalle sigue en el tooltip).
- ⚠ **`#prodList` se redibuja cada vez que `renderMerchants` corre en prod**: se arma con las entradas, sus países y el
  catálogo que dice cómo se llama cada una en prod (`prodSlugOf`), que llegan DESPUÉS. Abrir `/prod` directo dejaba la
  de antes: Pullman en «No están en prod» (sin catálogo, su clave `pullman` no es su slug de prod, `amoblando-pullman`) y
  todo en «Sin país».
- ⚠ La regla que muestra `#results` va con `body:not(.prod-mode)`: más específica que `.prod-mode #results`, la pisaba y
  en prod se veían las dos barras.
- **Las pestañas dicen sólo su nombre**, también Admin y las de prod (el ambiente y el canal, en el tooltip). **Prod sin
  pestaña** muestra los celulares vacíos, como los demás (se fue la tarjeta «Producción, a mano»). La ficha de la
  derecha se titula «Comercio». En prod sin pestaña la URL es `/prod` a secas, y el pie no arrastra el mensaje de local.
- **Lo que no está en el ambiente va en SU país, apagado** (opacidad de `.row.missing`), no en una vista aparte «No están
  en…» (se fue el 2026-10-21, en todos los ambientes y en prod). El país sale de la base del ambiente por hash
  (`merchant-tags`), que no lo sabe para lo que no está: por eso se RECUERDA por navegador (`harness.merchantCountry`,
  slug → país) cada vez que llega, y `countryOf` cae a ese recuerdo. Una entrada que nunca se vio en ningún ambiente
  queda en «Sin país».

### Un solo registro de comercios, y se agregan por consola (2026-10-21)

- **`harness/harness.json`, versionado, es la ÚNICA fuente.** Lo lee `pkg/flows.ts` (sin él, el `.flows.json` de antes),
  así que `bin/advisor`, los runners y el panel no cambiaron de camino. Las entradas con `panel: true` son la barra, en el
  orden del archivo, con `country` (como lo dice la base) y `note` (lo que ejercita: va en el tooltip). La lista curada
  que estaba escrita en `index.html` (`MERCHANTS`, con sus comentarios) se mudó ahí; `MERCHANTS` ahora se llena de
  `/api/registry`, que se lee en cada pedido: lo que cambia el CLI se ve al recargar.
- **Agregar y asociar es `make harness-merchants`** (`bin/merchants.ts`, con `pkg/merchant-registry.ts`):
  `add <slug|id|nombre>` busca el comercio en las tres bases (local y dev por `dbops`, prod por el conector) y toma la
  sucursal del asesor de prueba (`c<hash>-fake@`), o una activa con la advertencia. Es idempotente: lo que ya tenía
  sucursal la conserva. `associate <clave> <ambiente> <hash|comercio>` fija una base; `check [ambiente]` dice qué
  sucursal no existe; `remove [--purge]`. ⚠ **Un id no es el mismo comercio en prod** (Alta Fleet: 527 local, 346 prod):
  por id se busca sólo en local o en la compartida, y con el slug de ahí en las otras.
- **El panel no agrega**: se fueron el formulario (comercio → sucursal → nombre), `/api/catalog`, `/api/merchants`,
  `/api/branches-of`, `/api/favs`, «Agregar comercio…» y «Agregar desde prod». Escribe el registro sólo para RENOMBRAR
  la fila y QUITARLA de la barra (`panel` en falso: la entrada sigue para la consola). El buscador **filtra** la barra
  (también en prod): abre las vistas que coinciden mientras dura, sin guardar esa preferencia.
- **Sin rescate por slug**: `/api/branches` ya no busca el comercio por nombre cuando su sucursal no está, ni escribe el
  registro solo. Sin sucursal en la base, o con una que no existe ahí, la fila sale opaca en su país; su tooltip trae el
  comando `associate` y el clic lo copia (en el navegador del panel, un clic simulado no llega al portapapeles y dice
  «el comando está en el tooltip»).
- **Prod busca por la sucursal de prod del registro** (`prod_branch` → `prodRowOf`), no por slug: `/api/prod/catalog`
  devuelve `branches`, de qué comercio de prod es cada sucursal del registro (el catálogo trae sólo la del asesor de
  prueba y la menor por comercio; una asociada a mano se busca aparte con `prodBranches`). Al armarlo, las 9 que ya se
  veían en prod resolvieron con `add` y quedaron igual; Alta Fleet, BCP y CeluRD siguen sin sucursal de prod.
- Se fue el recuerdo del país por navegador (`harness.merchantCountry`): el país viene del registro.
