# CREDITOP · playground

Espacio propio de Miguel: organiza el conocimiento de **CreditOp** (fintech colombiana de originación
de crédito) y agrupa las herramientas de prueba. Existe para que un modelo entienda **antes** de atacar
una tarea.

## `make` es la puerta única

`make` sin argumentos lista todo lo que se puede correr, agrupado por para qué sirve. No hace falta
recordar en qué carpeta vive cada script — ni correr `make`: el hook `SessionStart`
(`session-start`, en `tablero/server/internal/hooks`) inyecta ese catálogo al arrancar, al reanudar y **después de
compactar**. Por eso acá **no hay lista de comandos**: la que había era una copia a mano que quedaba
vieja (llegó a anunciar un target `qa` que no existe). Lo que va acá es lo que `make` no puede decir:
**cuál elegir, y contra qué ambiente**.

⚠ **Antes de decir «no tengo acceso a eso», mirá el catálogo.** Loki, Redash, las cuatro bases de
datos, PostHog y Confluence ya están cableados y con credenciales. El error caro no es no tener la
herramienta: es suponer que no está y contestar de memoria.

### Qué herramienta según qué estás preguntando

| Tu pregunta | Con qué se contesta |
|---|---|
| **no conozco el dominio, ¿por dónde empiezo?** | canon — `make canon-search Q='…'` con palabras del negocio, y el tema que conteste, entero |
| **¿cómo funciona X?** | **canon** — el corpus compartido del equipo, en canon.playground.creditop.com. **Siempre primero.** `make canon-search Q='…'` (gratis) → `make canon-read IDS=…`. Para leerlo y para dictarle, el skill **`canon`** (`.claude/skills/canon/SKILL.md`) |
| **retomo una tarea del tablero** | `make retomar N=… BRIEF=1` — la tarea YA declara sus temas en `canon:`, así que no hay nada que elegir: lo que cuesta es leer los temas enteros (`kyc` 31 KB), y la **ficha** de cada tema alcanza para decidir cuál. ⚠ La ficha se DERIVA de los metadatos del tema (título, resumen y el `objetivo` de cada área, escritos a mano): no cuesta un modelo y no puede inventar. Medido el 2026-09-21: dos fichas pesan 7.055 B contra 51.284 B de sus documentos — **7,3×**. ⚠ Regla de corte: **si la ficha no contesta, no probés otro tema — la pregunta va al código de `main`** |
| **¿ya nos pasó?** | `tablero/data/traps/doc.md`, entrando por su índice de síntomas |
| **¿por qué existe esta regla?** (política, contrato, qué se le ofreció al comercio) | `make confluence` — el porqué del negocio no está en el código |
| **…y si canon no lo cubre** · **¿qué archivos toco para esto?** | **el código de `main`**, con `git grep` contra la rama (nunca el working tree: los repos viven en ramas). La ref de cada repo la da `go run ./cmd/repos ref <alias>`, desde `tablero/server`. ⚠ **En los dos monolitos**, o la afirmación sale falsa con evidencia real |
| **¿esto pasa de verdad, y cuánto?** | `make trazador-sql` contra **prod**. Es la única forma de contestarlo |
| **¿qué le pasó a ESTA solicitud?** | **Dos forenses, y la diferencia es dónde ANCLAN.** `make trazador-ureq UREQ=…` arranca en la BD —las etapas son hechos, salen aunque no haya un solo log— y suma los 39 pasos, qué VIO el cliente y qué archivos dejaron rastro; es la única que llega a **prod**. `make harness-loki UREQ=…` arranca en los LOGS y por eso trae lo que la otra no: la regla con la que se evaluó cada entidad y el `timeline.ndjson` completo con payloads — pero sin líneas no puede decir nada, y **no mira prod**. ⚠ Sus defaults son OPUESTOS (`local` vs `prod`): escribí `TARGET=` siempre, o cambiás de ambiente sin enterarte (F-234). Cada una imprime el comando de la otra al terminar. Si sólo tenés la cédula o el celular, `make trazador-buscar Q=…` primero. ⚠ `trazador-acceso` **no** es esto: es la sonda de «¿puedo leer los logs?» |
| **leí un error, ¿de qué archivo salió?** | `trazador/logs.json` — el índice va del mensaje al archivo y su línea (`make trazador-indexar-logs` lo reconstruye desde los repos). Para una corrida entera, el trazador ya lo resuelve: la sección «archivos» de `make trazador-ureq` |
| **¿qué VIO el cliente en pantalla?** | `make trazador-posthog UREQ=… TEL=…` — ⚠ **sin `TEL` ves la mitad**: la fase de AUTH ocurre antes de que exista la solicitud, así que PostHog la identifica por teléfono (medido: 47.792 eventos por teléfono contra 24.006 por solicitud) |
| **Miguel pegó una URL de una pantalla o de una capa** (del visor, de Figma o de una tarea) · **¿cómo es el diseño?** · **pasar una pantalla a código** | **`make visor-url U='<lo que pegó>'`** — ⚠ **lo que pega Miguel es el ANCLA: no salgas a buscar pantallas.** Dice qué es, a qué tarea del tablero está asociada, si cambió desde que se enlazó, y trae lo que hace falta: con una capa, su HTML exacto y los recortes de Figma y del HTML en esa zona; con una pantalla, el paquete (textos, destinos, imágenes, componentes, tokens, HTML). Las piezas sueltas —`visor-recursos` (imágenes originales), `visor-fidelidad`, `visor-tokens`, `visor-componentes`— y `visor-buscar` (sólo si nadie pegó nada). `make visor` es la interfaz, para mirar |
| **¿qué entidades le salen a ESTE comercio, y por qué no las otras?** | `make harness-listing MERCHANT=…` — **3 s**, por API y sin browser. Canon (`listado`) explica la CASCADA; esto contesta el CASO |
| **¿qué pasa si el cliente es así?** (ingreso, score, ocupación, plazo, entidad) | `make harness-case CASES='…'` — el flujo entero por API, en paralelo. `CLOSE=1` llega hasta el desenlace |
| **¿esta regla de verdad excluye, o sólo reordena?** | corré el caso con y sin el dato. Una regla que «debería» excluir y no excluye es el error más caro del dominio (F-162) |
| **¿funciona, corriéndolo?** | `harness` (`make panel`) es el camino VISUAL, de Miguel. **El tuyo es por consola, y son tres**: `harness-case` (el backend directo, segundos) · `harness-walk-wizard` (el wizard por HTTP, ~20 s) · `harness-walk-wizard ENGINE=browser` (el wizard en Chromium sin ventana, ~3 min, corre el JS de la página). Todos en paralelo. Cuál elegir: `harness/CLAUDE.md` §«Cuatro formas de correr un flujo». El canal de asesor pide sesión: `make harness-session` la revisa y `make harness-login` la saca por consola |
| **¿en qué anda el equipo?** | Slack (MCP) · `make cuadrilla` · `make tablero` |
| **buscar, crear o borrar en Jira · mandar a Slack** | `bin/pg jira …` · `bin/pg slack …` — leer es libre; lo que escribe **sin `--apply` sólo muestra** y el texto pasa por el guard. Registrado como MCP (`bin/pg mcp`), llegan como herramientas `jira_*` / `slack_*` junto con `sql`, `logs`, `confluence_*`… |

⚠ **Y hay preguntas que NO se contestan leyendo — se contestan corriendo.** Canon describe el
**mecanismo**, que generaliza; una corrida describe **el caso**, que no. Los dos hacen falta: la corrida
sin el mecanismo no se sabe interpretar, y el mecanismo sin la corrida no dice qué pasa con este
comercio. Medido el 2026-08-23 con la misma pregunta por los dos caminos: correrlo tardó **3 s** y dio
las 7 entidades con su `response_type`; leerlo eran **4 temas y ~9.000 palabras**, y **ninguno nombra <!-- lint:ok -->
ese comercio** — porque no es su trabajo.
⚠ **Y lo más importante: correr ENCUENTRA lo que leer no puede.** De los **12 hallazgos** agregados el <!-- lint:ok -->
2026-08-23 (F-163…F-174), **11 salieron de una corrida** — el único que salió de leer código fue F-170,
y lo disparó una pregunta. Un flujo que se rompe con la entidad ya elegida, un webhook que rechaza
siempre, una subida que falla en silencio: nada de eso está escrito en ningún lado hasta que alguien lo
corre.

⚠ **El silencio de canon NO es «no existe».** El corpus sólo sabe lo que alguien escribió, y su hueco
se lee igual que una ausencia real. Medido el 2026-08-16 sobre el árbol que lo precedió: dos
funcionalidades mergeadas —el endpoint de regeneración de Credifamilia (13/8) y el flag
`can_check_preapproval` (10/8)— no estaban escritas en ningún lado. **Cuando el corpus no diga nada de
algo que debería existir, no concluyas: andá al código de `main`, que es lo que corre.**

Regla de oro: **una afirmación verificable se verifica antes de escribirla**, y la herramienta que la
verifica casi siempre existe ya. Y cuando la verificás, **la medición no se escribe a mano**: con
`BLOQUE=<tarea>` el trazador (`trazador-ureq` · `trazador-buscar` · `trazador-sql`), el harness
(`harness-case` · `-listing` · `-walk-wizard` · `-suite`) y `tablero-db` la agregan solos a la pila de la tarea,
con el comando exacto y lo que dio —que es lo que hace que la medición se pueda desmentir mañana—. (`MD=1`
sigue dando la anotación para pegar en un documento que no es una tarea: un `CLAUDE.md`, una trampa.) Y la salida de un agente **también se verifica** —contra `main`, con
`git show main:<ruta>`, nunca contra el working tree: los repos viven en ramas.

### Y cómo se complementan ENTRE SÍ — cinco formas, las cinco medidas

La tabla de arriba dice cuál usar. Esto dice algo que no estaba escrito en ningún lado: **estas
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

### Contra qué ambiente

Elegí **el más chico que conteste la pregunta**. Subir de ambiente agrega riesgo, no verdad.

| | qué es | regla |
|---|---|---|
| `local` | tuyo, Docker | ⚠ **`E2E_TARGET` por defecto es `dev`, NO `local`** — omitirlo pega contra el dev compartido |
| `dev` | rama `develop`, **compartido con el equipo** | leer libre; **escribir** pide `I_KNOW_THIS_TOUCHES_SHARED_DEV` a mano (F-53) |
| `staging` | rama `staging`, backend propio | ⚠ **comparte la BD con `dev`** (es la misma). Su `APP_ENV` efectivo **no está confirmado** — ver abajo |
| `prod` | lo real | **SOLO LECTURA, siempre.** Las herramientas del trazador no escriben en ningún ambiente |

⚠ Y no asumas que el código está en los cuatro ambientes: un módulo nuevo puede faltar en `develop` o
`staging` y su 404 no ser un bug. Antes de depurar un 404 de un módulo nuevo:
`git -C <repo> ls-tree -r --name-only <rama> <ruta>`. *(Acá decía que `Modules/Backoffice` existía sólo
en `main`; verificado el 2026-08-28: ya está en `develop`. La regla general queda; el ejemplo caducó.)*

El detalle de cada `.env.<target>`, la partición de credenciales y por qué los permisos no van en
archivo: §«Variables de entorno», al final.

Convención: los **nombres propios** se quedan (`context`, `tablero`, `harness` son carpetas; `panel`
es la UI del harness) y los **verbos** van en inglés (`align`, `refs`, `seal`, `check`), como
`proyecto-verbo`.

### Las tres UIs comparten UN tema, y es un archivo

⚠ **Eran CUATRO hasta el 2026-09-21**, cuando se apagó la viz del árbol de `context/` (:5193). Las
medidas y los conteos de acá abajo se tomaron con las cuatro y **no se reescriben**: son lo que se
midió ese día. Lo que sí cambió es dónde viven los archivos —hoy tres copias, no cuatro— y eso lo
comprueba `make estilo-check`, que cuenta las que hay y no las que dice este texto.

**Fuente canónica (2026-09-19):** `tools/ui/theme.css`, `tools/ui/workbench.css` y
`tools/ui/workbench.js` y `tools/ui/RegionMenu.vue`. Editar allí y ejecutar `make estilo-sync`; `make estilo-check` detecta
cualquier copia desincronizada. El harness recibe el JS incrustado por el mismo comando, sin reiniciar
su servidor. Catálogo: `make estilo-guia` → http://127.0.0.1:5198; contrato actual en
[`tools/ui/README.md`](tools/ui/README.md).

**Preferencia de Miguel:** sin titlebar ni banners globales. Las acciones pertenecen al toolbar del
editor o de su región. El aviso de ambiente compartido del harness vive dentro del editor. El pie
ofrece alternar las regiones visibles conservando la última medida elegida. Los separadores admiten puntero y teclado con arrastre orgánico.
Las acciones frecuentes usan iconos con tooltip; las secundarias van en el menú de tres puntos de
cada región. El menú compartido admite teclado y marca las opciones activas. Los filtros de consola
indican «Filtrada» aun con el menú cerrado; entorno y canal conservan sus valores a la vista.
Los encabezados de región usan 12px, mayúscula inicial y 40px mínimos; el pie mide 30px. Esto reemplaza
las medidas y el uso de mayúsculas descritos en las notas históricas de abajo.

`context` (:5193), `harness/panel` (:5195), `tablero` (:5191) y `trazador` (:5192) tenían cuatro
paletas escritas a mano, con **cuatro nombres para el mismo concepto** —el texto apagado era `--dim`,
`--mut` y `--mut`; el acento era `--accent`, `--acc` y `--acc`; el rojo era `--fail`, `--bad` y
`--danger`—, así que no había forma de cambiarles el aspecto sin tocar las cuatro. Hoy:

- **`theme.css` es el archivo que se cambia, y es el MISMO en las tres** (`harness/panel` ·
  `tablero/src` · `trazador/src`). La fuente vigente es el tema Darkmatter de
  [ShadcnThemer](https://shadcnthemer.com/themes/278e858e-7c4c-4407-a4bc-2d48faadc5c8): al cambiar
  de tema se reemplaza el bloque de tokens y luego se ejecuta `make estilo-sync`. No lleva reglas
  propias de ninguna herramienta.
- **`make estilo-check`** es lo que hace que eso sea cierto y no una intención. Ocho chequeos, y cada
  uno nació de un error medido: md5 de los dos archivos compartidos · `in oklch` prohibido · contraste
  de las reglas que fijan color y fondo · variables usadas y nunca declaradas · el contrato de scroll ·
  **color literal adentro de una regla** · **reglas y media queries vacías** · qué región usa cada
  herramienta. Corrélo después de tocar estilos; sale ≠0 si algo está mal.
- ⚠ **Y el chequeo de contraste tiene un TECHO que hay que conocer: sólo ve reglas que fijan color Y
  fondo en la misma regla** —11 a 37 por herramienta—. Todo el resto del texto hereda el color de un
  ancestro y el fondo de otro, y eso no se resuelve leyendo CSS. Para eso está **`tools/contrast.js`**:
  recorre el DOM, resuelve el fondo efectivo subiendo por los ancestros y mide cada nodo con texto
  propio (también se puede pegar en la consola, con la herramienta abierta). La primera corrida sobre
  las cuatro encontró 22 nodos abajo del umbral —10 casos distintos— que el estático no veía: dos <!-- lint:ok -->
  quedado con la piel POR DEFECTO del navegador (#efefef sobre fondo oscuro), una manija de arrastre en
  **1,38:1** pintada con un token de borde, y tres textos con `opacity` apilada encima de la rampa.
  **Está cableado: `make estilo-contraste`** lo corre en las cuatro con el Chromium del harness. ⚠ NO
  levanta servidores —los puertos son tuyos— así que audita lo que esté corriendo y lo que no sale
  `SIN VERIFICAR` con exit 2, nunca en verde. Probado al revés con un `#555` inventado: sale ✗ y con 1.
  ⚠ Y tres trampas que costaron una corrida cada una: **Vite escucha sólo en IPv6**, así que sondear
  `127.0.0.1` da «no hay nada» sobre un servidor sano; **`networkidle` no llega nunca** en el panel,
  que pollea; y **las tareas del tablero llegan después del HTML**, así que con 600ms de espera el
  barrido medía una app vacía y decía ✓. *(Decía «por WebSocket»: la UI las pide por `fetch`, y el `/ws`
  del server, que no tenía cliente, se retiró el 2026-09-23. La trampa es la misma.)*
  ⚠ Dos trampas medidas al construirlo: **Chrome deja `oklch()` sin resolver en el computed style**
  (parsear esos números como RGB da 1,00 en todo — hay que pintar el color en un canvas y leer el
  píxel), y **`opacity` se apila sobre el color** sin que el chequeo estático lo vea, porque la regla
  sola es correcta. ⚠ Y se apila también la de los **ancestros**: hasta el 2026-09-23 la auditoría
  aplicaba sólo la del nodo, y la fecha de un hallazgo del tablero —ítem en `.85` × su línea en `.6`—
  salía verde estando en 3,53:1. Hoy multiplica la cadena entera; al estrenarlo, el panel del harness
  pasó de 7 a 21 nodos bajo AA.
- **La tinta compacta usa la rampa de `workbench.css`, no `--muted-foreground`:** los temas cambian su
  contraste relativo. `--fg-2` (74%) y `--fg-3` (70%) se derivan de `--foreground`; cualquier
  combinación explícita de tinta y superficie se verifica con `make estilo-check`. `--accent` es una
  superficie, así que su texto siempre usa `--accent-foreground`.
- Cada herramienta tiene, al lado, **su propia hoja con el PUENTE**: sus nombres viejos apuntando a
  los tokens (`--bg: var(--background)`, `--mut: …`) y lo que sólo significa algo ahí —el estado de una
  etapa, el carril de un ramal, el semáforo de un scorecard—. **Ese color semántico NO va en `theme.css`
  a propósito**: el export de un tema no lo trae, así que pegar uno nuevo encima lo borraría.
- Las tres apps de Vite además tienen **Tailwind v4** enchufado (`@tailwindcss/vite`), con los tokens
  ya mapeados a utilidades por el `@theme inline` del tema. ⚠ Las utilidades van en `@layer
  utilities` y **el CSS sin capa —todo lo que ya existe— les gana**: sirven para markup nuevo, y para
  migrar un bloque hay que borrarle la regla, no competirle. El panel del harness **no** tiene
  Tailwind: no tiene bundler (`npm run dev` es `node panel/server.ts`), así que consume el mismo
  `theme.css` por `<link>` y listo.

⚠ **Tres trampas medidas el 2026-09-18, las tres silenciosas** (ninguna hace fallar nada):

1. **Un tinte se mezcla `in oklab`, NUNCA `in oklch`.** Los neutros de tweakcn son `oklch(L 0 0)`:
   croma 0 y **hue 0, que es el rojo**. `oklch` es polar, así que `color-mix` interpola ese hue y
   arrastra el matiz — `color-mix(in oklch, #4ade80 20%, var(--card))` da **#4d3530**, un marrón
   rojizo, donde `in oklab` da **#2d4132**. Pasa con los cuatro colores. `make estilo-check` lo frena.
2. **Una variable sin declarar hace que el navegador tire la declaración ENTERA, sin decir nada.**
   `scorecards/` del tablero venía de otra paleta y usaba diez nombres que nadie declaraba: 60
   declaraciones muertas, o sea una vista sin superficies, sin bordes y sin semáforo. Se ve como un
   diseño feo, no como un error.
3. **`--accent` en shadcn es una SUPERFICIE** (#404040, con su `--accent-foreground`), no un color de
   texto. `trazador` y `context` lo usaban como el azul de los enlaces: aliasarlo dejaba texto #404040
   sobre fondo #1a1a1a. Ese uso se llama `--info` ahora.

### Y cómo se DIVIDE la pantalla: los nombres son los de VS Code

Hermano de lo anterior, y el mismo mecanismo: **`workbench.css`, idéntico en las cuatro**, al lado de
`theme.css`. El tema dice de qué COLOR es cada cosa; el taller dice QUÉ COSA ES. Son dos ejes y por eso
son dos archivos — un tema se reemplaza entero y el taller no, porque ahí hay decisiones (cuánto mide
un sidebar, qué scrollea) que ningún export de tweakcn trae.

Las regiones: `titlebar` · `banner` · `activitybar` · `sidebar` · `editor` · `panel` (la consola de
abajo) · `auxiliarybar` (el sidebar secundario) · `statusbar`, y adentro de cada una `region-head` y
`region-body`.

- ⚠ **Una región existe cuando tiene contenido propio Y scroll propio.** Es lo que separa un
  vocabulario de una ceremonia: un `activitybar` vacío porque «está en la lista» es peor que no
  tenerlo. Hoy: el panel del harness y el tablero son workbenches completos —el tablero con el
  sidebar en acordeón y sin activitybar, porque con UN solo contenedor de vistas esa columna no cambia
  nada— · `context` usa dos
  (`sidebar` el árbol, `editor` el detalle) · el trazador dos (`editor` el mapa, `auxiliarybar` los
  logs). `make estilo-check` lo lista, así que se ve de un vistazo quién adoptó qué.
- ⛔ **NINGUNA usa `titlebar`, y eso es el resultado de medirlo cuatro veces.** Una barra a lo ancho de
  la ventana le cobra su alto a TODAS las regiones, incluidas las que no usan nada de lo que hay ahí —
  y casi siempre lo que hay ahí le pertenece a UNA. Lo que se hizo en las cuatro es lo mismo: **su
  contenido baja a la barra de la región de la que habla**, y lo que quedaba —el nombre de la
  herramienta— se va, porque eso lo dice la pestaña del navegador. Medido, en px de alto ganados:

      tablero    titlebar 77  →  el editor y los dos sidebars se lo reparten
      context    titlebar 44  →  el buscador baja al ÁRBOL (es lo único que filtra); el detalle +43
      trazador   titlebar 60  →  el buscador baja al MAPA; el panel de logs +60, el mapa igual
      harness    titlebar 52  →  perillas y correr bajan al RECORRIDO; los dos sidebars +52 c/u

  El patrón que se repite en las cuatro: **la región que usaba la barra no gana ni pierde** (paga lo
  mismo, ahora en su propia cabecera) **y las demás ganan el alto entero**. El nombre sigue en
  `workbench.css` porque es el vocabulario de VS Code y una herramienta futura puede necesitarlo; que hoy
  no lo use nadie **no es un olvido**.
- **Una región puede tener VARIAS VISTAS apiladas** (`.view`), como el sidebar primario de VS Code:
  el árbol arriba y OUTLINE/TIMELINE colapsadas abajo. ⚠ **Una vista cerrada cuesta UNA FILA, no
  cero** — es la misma regla que el canal deshabilitado del panel del harness: verla apagada dice que
  existe y que ahora no corresponde; esconderla hace creer que no existe. Y ⚠ **no todo lo que se
  pliega es un `.view`**: esto es para vistas que se reparten el alto de una región de alto fijo. Para
  secciones dentro de un cuerpo que scrollea, el elemento correcto es `<details>`, que no necesita JS
  (el panel del harness ya tiene ocho así).
- **Las manijas de redimensionar comparten el ASPECTO pero no dónde van** (`.rsz` en `workbench.css`):
  una línea de 1px se ve pero no se agarra, así que la zona de agarre es más ancha y sólo se pinta al
  pasar por encima. Dónde va la pone cada herramienta —el panel del harness las tiene como pistas de
  su grid, el trazador en capa sobre el mapa, el tablero pegadas al borde de cada sidebar. ⚠ Y el tope
  de un arrastre **no puede ser un número fijo**: se calcula contra la ventana y el ancho de la otra
  columna, o la región del medio se queda sin ancho usable.
- **Un grupo dentro de una vista lleva el MISMO encabezado** (`.region-head.group`), y no uno más
  grande: un grupo que se ve más fuerte que la vista que lo contiene invierte la jerarquía. Lo que los
  distingue no es el tamaño sino el comportamiento — el de la región está fijo y el del grupo scrollea
  con la lista, pero **se pega arriba**, así que mientras recorrés un grupo largo siempre sabés en
  cuál estás. Por eso cada región declara su superficie (`--region-bg`): un hijo pegajoso tiene que
  pintarse opaco con el color de DONDE ESTÁ, no con uno fijo.
- **El encabezado de una región lleva barra de acciones y menú `⋯`**, como el Explorer de VS Code, y
  la división es lo que lo hace funcionar: en la **barra** lo que se HACE y es frecuente (iconos
  siempre a la vista); en el **menú** lo que se ALTERNA y se toca poco, con su tilde y su conteo.
  ⚠ Y un botón de la barra es un **icono de 24×24** (`.region-action`): un texto adentro se parte en
  dos renglones y se sale de la región — «⧉ copiar traza» quedó como «copi / traz» tapado por el panel
  de al lado. Lo que dice el botón lo dice su `title`.
  ⚠ Y hay **una condición para mandar un filtro al menú: el encabezado tiene que delatar que está
  puesto.** Un filtro escondido que nadie ve se olvida encendido, y después lo que falta se lee como
  «no existe». En el tablero eso lo dice el contador, que pasa de `9` a `9 / 16` en ámbar; sin esa
  señal, el filtro se queda a la vista. Primer uso: las seis casillas de estado del tablero, que eran
  tres renglones de pastillas antes de la primera tarea.
- ⚠ **Adoptar una región es SOLTARLE a la herramienta lo que la regla compartida ya dice**, no
  agregarle una clase encima. En `context` fue soltar el `background` del árbol: ahora lo pone
  `--sidebar` (#1f1f1f), un escalón por detrás del `--card` (#202020) del detalle, y las dos columnas
  dejan de ser la misma superficie. En `tablero` fue dejar que el encabezado tome la banda —fondo y
  borde abajo— que lo separa del contenido. Las desviaciones se DECLARAN en la hoja de cada una: en
  `context` las dos columnas son tarjetas dentro de una página, no regiones a sangre, así que se
  quedan con su borde y su radio.
- ⚠ **Y un nombre que no cambia nada es un nombre que alguien va a borrar.** Se probó etiquetar el
  mapa del trazador como `.editor`: su regla propia ya decía todo lo que la compartida diría, y lo
  único que sumaba era un `display:flex` que no tenía. Se sacó.
- **El contrato de scroll**: `.workbench` ocupa la ventana y **cada región scrollea sola; la página
  nunca scrollea**. Es opt-in, y `make estilo-check` lo verifica — incluido el atajo prohibido de
  fingirlo con `max-height: 82vh`, que el día que el header crezca una línea miente.
- El panel del harness es la **implementación de referencia**: el vocabulario se extrajo de ahí, no se
  inventó. Ya tenía el grid, las medidas en tokens y hasta los nombres (`.titlebar`, `.statusbar`).
  Se desvía en una cosa, declarada: mete sus tres columnas del medio en un `.shell` propio para poder
  redimensionarlas.
- ⚠ **Y una regla que costó dos intentos: una cabecera que junta varias cosas ENVUELVE, no desborda.**
  Adentro de una región, el ancho ya no es el de la ventana — depende de cuánto midan los sidebars de
  al lado, que se arrastran. La fila del recorrido del harness pide 823px: a 1512 entra en un renglón
  y a 1440 «Preparar + Lanzar» terminaba **17px debajo del sidebar vecino**, sin que nada fallara. Va
  `flex-wrap: wrap` **más `height: auto`**: `.region-head` fija `height: 32px`, y un `min-height`
  encima da una caja FIJA —no una que crece—, así que el segundo renglón queda afuera igual.

⚠ **Y la colisión que hubo que resolver primero, que es el mismo error de `--accent`:** en VS Code
`panel` es **la consola de abajo**, y en las cuatro herramientas `--panel` era un **color** (la
superficie de card) mientras `.panel` era un cajón. Tres significados para un nombre. Hoy el color es
`--card` (que ya venía del tema), los cajones son `.drawer`, y `panel` significa una sola cosa.

### Y con qué se separa una cosa de otra: SIETE reglas, las siete aplicadas en las cuatro

El tema dice el color y el taller dice qué región es cada cosa. Falta la tercera pregunta, que es la
que deja restos del diseño anterior: **¿con qué se separa un bloque del de al lado?** Antes se
contestaba con una caja —fondo propio + borde de 1px + radio— y eso es lo que se barrió el 2026-09-19.
La vara es medible y se toma en el navegador, no leyendo CSS: *¿cuántos elementos pintan un borde de
**3 o 4 lados** y miden más que una píldora?* Antes: 21 en `context`, 24 en el documento del tablero,
uno por cada `.card` del harness. Hoy: **cero contenedores** en las cuatro — lo que queda son inputs,
selects, iframes, imágenes y píldoras, que son objetos, no contenedores.

1. **Una región no lleva marco.** Lo que la separa es el escalón de fondo más UNA línea. Un borde
   alrededor de algo que ocupa toda su columna no separa nada. ⚠ Y cuidado con la costura doble: si la
   región de la izquierda pone `border-right` y la de la derecha `border-left`, hay 2px donde va 1 —
   medido en el trazador, el mapa pintaba en 546–547 y el panel en 547–548.
2. **Una sección dentro de una región se separa por su ENCABEZADO**, que sale **a sangre** (`margin: 0
   -<padding>`) y se lee como una banda de lado a lado. Con aire a los costados vuelve a leerse como
   otra tarjeta. Lo usan el panel del trazador y las vistas del tablero.
3. **Un callout es una barra de color a la izquierda y un tinte, CUADRADO.** Ni marco completo —no
   dice nada que el tinte no diga— ni `border-radius: 0 r r 0`, que redondea justo el lado que no
   tiene nada y deja la barra recta peleando con una curva a 2px.
4. **Una tabla son líneas por FILA, no una grilla de celdas.** El marco por celda pesa más que los
   datos; las columnas las alinea el texto. (Y el encabezado se distingue en gris, no con fondo.)
5. **Una píldora es relleno O contorno, nunca los dos.** Fondo teñido + borde teñido del mismo color
   es un anillo que la engorda sin agregar información. Encendida = relleno, apagada = contorno: la
   pareja default/outline de shadcn, que además dice el estado con la FORMA.
6. ⛔ **El cromo muerto se BORRA, no se anula** —y una regla que quedó VACÍA es su forma más visible,
   por eso la caza el chequeo 7. El caso del harness: `.card` tenía fondo, borde, radio
   y 20px de padding, y **tres bloques más abajo se los quitaban uno por uno**. Ninguno de los cuatro
   `.card` de la pantalla dibujaba su caja — pero el que agregue el quinto en un lugar nuevo se lleva
   la caja vieja sin pedirla. El anulador conserva lo que AGREGA y pierde lo que niega.
7. **Un color literal no sobrevive a un cambio de tema.** `#d8a657`, `#0a0c10`, `#fbbf24`, `#fff`: un
   export de tweakcn pegado encima los deja intactos, y así se destiñe una UI de a un detalle por vez.
   Lo que SÍ lleva un literal es la **declaración de un token** (`--ok: #22c55e`) y la sombra de un
   popover, que es negra en cualquier tema. Los demás se declaran: los `response_type` y los productos
   del harness son tokens desde hoy, igual que los carriles del trazador. **Cableado** en el chequeo 6.
   ⚠ Y al pasarlos a token, **el token tiene que existir en ESA herramienta**: puse `var(--fail)` en el
   harness por costumbre del trazador y ahí se llama `--danger`; el navegador habría tirado la
   declaración entera sin decir nada. Lo cazó `make estilo-check`.

⚠ **Lo que NO se toca: el cromo de un OBJETO.** Un input, un select, un botón, un iframe con contenido
ajeno y la miniatura de un screenshot sí llevan su marco y su radio — son cosas, no cajas alrededor de
cosas. La pregunta que discrimina: *¿esto ENVUELVE contenido de la app, o es una pieza en sí misma?*

### ⛔ La suite de PHPUnit de `legacy-backend` NO se corre entera. Nunca, en ningún ambiente

**El 2026-08-19 la BD compartida de dev+staging quedó vacía.** La causa raíz medida:
`phpunit.xml` fija `DB_DATABASE=testing` **pero nunca fijó `DB_HOST`** (cero commits en toda la historia
del repo), así que las pruebas se conectan **al servidor que diga el `.env`** — y las credenciales que
circulan son las del usuario **maestro del RDS, con `DROP`**. Dos tests usaban `RefreshDatabase`, que
corre `migrate:fresh`: **borra todas las tablas** y después migra.

*(Acá decía «sigue abierta». Ya no: verificado el 2026-09-03 contra `main`, el commit `d3323457` —PR
`Creditop-SAS/legacy-backend#1140`— borró los dos tests y agregó una **guarda** en
`tests/CreatesApplication.php` con lista blanca de hosts (`127.0.0.1`, `localhost`, `::1`, `mysql`,
`sail-mysql`) y schemas (`testing`): si la suite apunta a otra parte, **la corrida aborta**. Va en
`createApplication()` porque Laravel lo llama antes de `setUpTraits()`, que es donde `RefreshDatabase`
dispara el borrado. Llegó a `main` entre el 2 y el 3 de septiembre.)*

⚠ **Pero la prohibición se queda, y el motivo es `make fresh`:** sigue siendo
`artisan migrate:fresh --seed --force`, **no pasa por esa guarda** y apunta a donde diga tu `.env`. La
práctica que puso un host remoto en el `.env` de alguien —aplicar migraciones a mano desde contenedores
locales contra la base compartida— tampoco cambió. El detalle
completo: `tablero/tasks/tests-pueden-borrar-la-bd-compartida/task.md` (CORE-431) y su documento de
arranque en `artifacts/…hipotesis.md`, en la misma carpeta.

**Los archivos que recrean la base, hoy: SEIS — y una carpeta que lo hereda.** Verificado contra
`origin/main` el 2026-09-08, `RefreshDatabase` se activa de **tres** formas y el chequeo de abajo veía
una sola:

1. **el trait dentro de la clase** (`use RefreshDatabase;`): **uno**,
   `Modules/Backoffice/Tests/Feature/LenderRulesWriterServiceTest.php` (en `main` y en `qa`; en
   `develop` no está);
2. **la forma de Pest, por archivo** (`uses(RefreshDatabase::class);`): **cinco** vivos y sin comentar
   —`tests/Feature/Commands/UnrollDevicesPaidCommandTest.php`,
   `tests/Feature/Console/SyncDeviceLocksCommandTest.php` y los tres de `tests/Feature/Jobs/`—, con 43
   tests entre los cinco. `tests/Feature` es una testsuite declarada en `phpunit.xml` y Pest es el
   runner del repo (`pestphp/pest: ^2.36`);
3. **la forma de Pest, por DIRECTORIO**: `Modules/UserRequestV1/tests/Pest.php` hace
   `uses(Tests\TestCase::class, RefreshDatabase::class)->in('Feature')`, así que **lo hereda cualquier
   archivo de esa carpeta sin decirlo en su propio texto**. Sus seis archivos están hoy envueltos
   enteros en un bloque de comentario, así que no corre ninguno — pero el que agregue uno nuevo ahí
   recrea la base sin haber escrito nada al respecto.

✔ **Y la parte tranquilizadora: la guarda de CORE-431 no mira la forma.** Vive en `createApplication()`,
que Laravel llama **antes** de `setUpTraits()`, así que las tres quedan igual de contenidas a los hosts
de esta máquina y al schema `testing`. Lo que el chequeo de abajo contesta no es «esto es seguro» —eso
lo contesta la guarda— sino **«qué le va a pasar a MI base local si corro esta carpeta»**. Lo que sigue
afuera de la guarda es `make fresh`.

*(Acá decía «hoy NINGUNO, verificado contra `main` el 2026-09-03». Era falso, y el motivo vale más que
el dato: se verificó con `git grep -E '^\s*use RefreshDatabase;'`, y **`git grep` no entiende `\s`** —su
motor de expresiones no tiene esa clase—, así que no matcheó nada y el cero se leyó como «no hay».
El `grep` del sistema sí la entiende, que es por qué el comando de más abajo, sobre archivos, funciona.
Para preguntarle a un árbol de git hay que usar POSIX:*

    git grep -lE '^[[:space:]]*use RefreshDatabase;' origin/<rama>

*Dos de los tres sí se borraron —`SafeCancelTest` y `CreditopXDatacreditoAdjustmentServiceTest`—; el
tercero nunca perdió el trait.)*

Que hoy haya uno solo **no es una propiedad del repo, es un estado**: nada impide que mañana entre otro,
y la guarda protege el host, no el borrado. Por eso el chequeo de abajo se sigue haciendo antes de correr
una carpeta.

**Desde el 2026-09-14 esto NO depende de acordarse: el hook `destructive-tests`** (PreToolUse
sobre Bash) frena la suite sin ruta, el `fresh`/`wipe` de la base, el `test` del Makefile de
legacy-backend, y una ruta que arrastre `RefreshDatabase` en cualquiera de sus tres formas — sólo para
comandos que hablen de legacy-backend, y mirando la POSICIÓN DE COMANDO (nombrar la palabra en un
commit o un grep no frena). Si de verdad querés recrear tu base local, el comando lleva
`I_KNOW_THIS_RECREATES_MY_LOCAL_DB=1`. La lista de abajo sigue valiendo fuera de una sesión con hooks
(la terminal, el editor).

⚠ **Y hasta el 2026-09-23 tenía dos huecos, los dos hacia el lado peor** (medidos al pasarla a Go,
`tablero/server/internal/hooks/destructive.go`): una raíz con `~` o relativa
(`cd ~/Desktop/…/legacy-backend && sail artisan test <carpeta con el trait>`) no se resolvía y el
comando pasaba; y con el cwd en un worktree (`legacy-backend-x`) la guarda fallaba por dentro y salía
0 — incluso para un `db:wipe` en el mismo comando. Los dos están cerrados y cada uno tiene su prueba.

**Lo que NO se hace:**

- `make test` en `legacy-backend` (es `artisan test` pelado: corre los 140 archivos, incluido el del trait)
- `make fresh` (es `migrate:fresh --seed --force`: hace el mismo daño sin pasar por ningún test)
- `artisan test` / `artisan migrate:fresh` sin ruta
- darle *Run* a un archivo de test desde el editor: PhpStorm y VS Code **no siempre cargan
  `phpunit.xml`**, así que ahí no hay ni siquiera el candado del nombre

**Lo que sí se hace: correr SOLO lo que valida la tarea, siempre con ruta explícita.**

    ./vendor/bin/sail artisan test <ruta/al/archivo o carpeta>       # una ruta, siempre
    ./vendor/bin/sail artisan test --filter=nombreDelTest <ruta>     # aún más angosto
    make test-onboarding                                            # ya viene acotado por rutas

Antes de correr cualquier carpeta, comprobá que no arrastra el trait:

    grep -rlE '^\s*use RefreshDatabase;|uses\(.*RefreshDatabase::class' <ruta>
    ls <ruta>/Pest.php <ruta>/../Pest.php 2>/dev/null   # si hay, LEELO: puede atarlo al directorio

⚠ **TRES formas de que este chequeo mienta, y las tres ya pasaron.** (1) Grepear sólo
`RefreshDatabase` da ~30 archivos en `main` y **todos son falsos positivos** (lo mencionan en un
import, en un comentario, en un README o en un script): hay que anclar el `use` al principio de línea.
(2) Si en vez de archivos le preguntás a una RAMA, `git grep` **no entiende `\s`** y devuelve cero sin
fallar — ahí va `'^[[:space:]]*use RefreshDatabase;'`. Y (3) la que costó dos conteos falsos: **un
`uses(RefreshDatabase::class)` no empieza la línea con `use`, así que el patrón anclado no lo matchea
NUNCA** — ni sobre el árbol ni sobre la rama. Por eso el comando lleva la segunda alternativa, y por
eso hay que abrir el `Pest.php`: la forma por directorio no se ve grepeando los tests. Un chequeo que
contesta «no hay» cuando no supo buscar es peor que no tenerlo.

**Y si de verdad hiciera falta correr algo destructivo**, no alcanza con mirar el `.env`: es el `.env`
**más** el entorno de la shell **más** `DATABASE_URL`, que pisa a todos. La regla práctica es más
simple: **no corras nada destructivo; si creés que hace falta, preguntá.**

## EL CICLO — acá siempre pasa lo mismo

Se viene a resolver **tareas** sobre CreditOp con cuatro piezas — **tablero** (la tarea), **canon**
(el conocimiento curado, COMPARTIDO con el equipo y en otro repo), **harness** (la prueba) y
**trazador** (lo que ya pasó, incluido en prod) — y el circuito es fijo. Lo que canon aún no cubre se
lee en el código de `main`. *(Hasta el 2026-09-24 había una quinta, `workers/`: un índice derivado del
código con agentes de Gemini encima. Se retiró; la conexión a Gemini quedó en `connectors/gemini`.)*

⚠ **Canon no vive acá: vive en `~/Desktop/CREDITOP/github/playground/tools/canon`** (repo
`Creditop-SAS/playground`), y se publica en canon.playground.creditop.com. Hasta el 2026-09-21 este
repo tenía ADEMÁS su propio árbol curado, `context/`, y eran dos contextos que había que mantener a la
par. Se apagó: lo que valía graduó a canon, las trampas del sistema se mudaron a
`tablero/data/traps/` y lo que quedaba era formato o estructura. **No busques `context/`; si lo ves
citado en algún lado, está viejo.**

⚠ **Y cada una tiene un lugar propio DENTRO del archivo de la tarea.** El `CLAUDE.md` de las cuatro que
no son el tablero cierra con una sección «Qué deja esto en la tarea», y
[`tablero/CLAUDE.md`](tablero/CLAUDE.md) §«De dónde sale lo que se escribe acá» es su espejo. Sin eso
la información se escribe igual, pero suelta en la prosa, donde nadie la encuentra al retomar: medido
el 2026-09-18, **43 de 68 tareas nombran el contexto curado y sólo 40 lo declaraban en el
frontmatter**; el arnés aparece en 33 y **sólo 8 lo nombran dentro de «Cómo se comprueba»**. Hoy el
campo se llama **`canon:`** y sus valores son temas del corpus.

1. **La TAREA vive en `tablero/tasks/<slug>/`** (una tarea = una carpeta: `task.md`, su pila
   `context.jsonl` y sus `artifacts/`): en qué se trabaja, por
   qué y para qué — estado, decisiones, riesgos, preguntas abiertas.

   ⚠ **Buscá el archivo que YA cubre esto antes de crear uno: `make tareas TODAS=1`.** El `id` del
   frontmatter es lo que hace visible una tarea en el tablero: **`id: 0` no tiene tarjeta**, ni botón de
   bitácora, ni cajón de ramas. Escribir el avance ahí es escribirlo donde nadie lo mira — pasó el
   2026-08-27 y el tablero mintió ocho días mientras se mergeaban PRs.

   ⚠ **Y al cerrar la sesión son TRES cosas, no una:** un bloque del día en la pila de la tarea (`make
   tarea-bloque`) · declarar `ramas:` y volver a medir con `make tareas-ramas` · escribir la bitácora en
   `tablero/data/entries/` **con minutos medidos** (`make pulso`, o el lapso de commits), no estimados.
   **`make cierre` chequea las tres** y el hook de `Stop` lo corre solo. *(Hasta el 2026-09-23 eran
   cuatro: reescribir el estado de arriba con su «próximo paso» se fue con la pila de bloques.)* El
   detalle y lo medido que lo justifica: `tablero/CLAUDE.md`.
2. **El CONTEXTO se lee ANTES de investigar, y está en canon.** Para encontrar el tema:
   `go run . -pregunta '<la pregunta>'` desde el repo de canon, o `/api/search?q=…`, que es gratis y
   devuelve la sección exacta con los archivos que la sostienen. Cada tema tiene su prosa (secciones)
   y su mapa (las áreas, con sus `fuentes`: archivo → hash del blob contra el que se verificó), y los
   dos viven en la base de canon, en Postgres: cada escritura es una revisión con autor, motivo y
   fecha. Se leen por la API (`/api/read`, `/api/code`) y no hay archivos del corpus en ningún repo. El
   código real vive **fuera**, en `~/Desktop/CREDITOP/github/`
   (`legacy-backend`, `frontend-monorepo`, `legacy-application`, `pre-approvals-service`) — grandes:
   entrar por grep sin mapa es la forma lenta. ⚠ Y al **retomar** no se elige tema: la tarea ya lo
   declara en `canon:`. `make retomar N=… BRIEF=1` trae la ficha de cada uno para decidir cuál abrir
   — la ficha decide, no reemplaza.
3. **Lo que se descubre SE REGISTRA, con tres destinos.** El test: *si esto se mergea mañana, ¿el
   texto sigue siendo cierto?*
   - una **regla de negocio** que ya existe en `main` y canon no tiene → **canon**, en el momento,
     sin esperar a que la tarea termine: se busca en canon, se verifica viva en `main` de los dos
     monolitos y se dicta. El recorrido: `tablero/CLAUDE.md` §«Cuando aparece una regla de negocio»;
   - hallazgos **de la tarea** (avance, mediciones, decisiones, riesgos, preguntas) → su **pila**, como
     bloques (`make tarea-bloque`, o `BLOQUE=` en la herramienta que lo midió); lo que sigue siendo
     cierto del plan, a su `.md`;
   - trampas **del sistema**, verificadas (síntoma → causa raíz → evidencia → arreglo) →
     `tablero/data/traps/doc.md` (F-01…). **Mirala antes de depurar un muro**: si
     ya nos pasó, está ahí.
4. **Probar de verdad es `harness/`** (panel, runners, mocks): se comprueba **corriendo**, no
   leyendo. Una afirmación que se puede verificar ahí se verifica **antes** de escribirla como cierta.
   ⚠ **Y en local/dev/staging las centrales de riesgo NO las atiende el proveedor**, sino un lambda de
   mocks de la empresa (`Creditop-SAS/risk-services-mockery-lambda`, un Mockoon; no está entre los
   repos de arriba). Se le puede **dictar la respuesta por cédula** — la receta vigente y sus trampas
   están en `tablero/data/traps/doc.md`, F-139. Sin saber esto, una prueba de identidad
   ahí siempre devuelve la misma persona y parece que el código está roto.
5. **Al mergear, GRADÚA:** lo mergeado deja de ser tarea y pasa a canon — ahí es "cómo funciona
   CreditOp", y lo ve el equipo. La tarea se marca `archived` en su frontmatter. Ejemplo hecho: la
   omisión de Experian por cupo ya confirmado vive hoy en el tema `kyc`.

   **Cómo se escribe en canon:** por la API, con la llave de escritura (`CANON_WRITE_KEY`, en el
   `.env` de `tools/canon`): `POST /api/draft` → una pieza por sección con `POST /api/draft/{id}` →
   `POST /api/draft/{id}/close`. El cierre valida el corpus entero y guarda todo junto en una revisión;
   al confirmarse ya es conocimiento vigente. `POST /api/propose` ensaya una pieza sin escribir. ⚠ La
   escritura va contra canon de **producción** (canon.playground.creditop.com), que pide la VPN de
   prod; la instancia local (`localhost:8080`) tiene su propia base y lo que se escribe ahí no lo ve
   el equipo.

   ⚠ **Canon rechaza la CRÓNICA por regla escrita** (`skills/dictar.md`): van las reglas que existen
   en `main` —técnicas, de negocio o de producto, incluidos sus errores—, sin el relato de quién las
   descubrió, sin resultados de experimentos y sin PRs sin mergear. Lo que no pasa ese filtro y aun
   así vale es una **trampa del sistema**, y va a `tablero/data/traps/doc.md`.

### Y lo que mergea OTRO — el bucle para que canon no quede viejo

El paso 5 cubre lo que mergeás vos. Lo que mergea el resto del equipo entra sin que nadie lo escriba, y
el hueco no avisa. **El bucle, probado el 2026-08-16 sobre el árbol que precedió a canon y que encontró
dos funcionalidades invisibles:**

1. **`go run . -ronda`** desde el repo de canon — qué archivos declarados cambiaron en `main` o
   desaparecieron. Cada área declara sus `fuentes` con el **hash del blob** contra el que se verificó,
   así que esto es una comparación exacta, no una estimación. ⚠ Y **`-peso`** ordena esa lista por
   actividad de 90 días: sin eso, el ranking mezcla un archivo que cambió una vez con el que cambia
   todas las semanas. ⚠ Los dos aportan cosas distintas, y está medido: Credifamilia salió de la
   deriva (un archivo repitiéndose en varios temas), y `can_check_preapproval` salió de mirar el
   cambio de un tema con deriva **baja**. Mirar sólo el ranking se pierde lo segundo.
2. Confirmá que el hueco es real: `git log main --oneline -- <ruta>` (cuándo entró y quién) + una
   búsqueda en canon (`/api/search?q=…`). Si nadie lo menciona, ahí hay algo.
3. Leé el código que cambió, en `main` y en los dos monolitos.
4. **Verificá contra `main`** lo que devuelva, y recién ahí dictalo a canon (por la API, paso 5). ⚠ El
   cambio de prosa y el del hash van **juntos**: mover el hash sin releer dice «esto sigue siendo cierto» sin que nadie lo
   haya comprobado.
5. **Una sección nueva no revalida el área entera.** Agregar no es revisar; decir que revisaste lo que
   sólo ampliaste es la forma más barata de envejecer un corpus sin que se note.

⚠ **Canon NO documenta las herramientas de este repo.** `harness` y `trazador` tuvieron nodo en el
árbol viejo hasta el 2026-09-21; se retiraron porque el corpus describe **CreditOp** y cómo se usa una
herramienta de acá vive en su `CLAUDE.md`, commiteado junto a su código. No era redundancia inofensiva:
la tabla de «quién decide el crédito por `response_type`» estaba en los dos lados y **ya se
contradecía**. Lo de dominio se repartió; lo operativo, a los `CLAUDE.md`.

⚠ **Las exploraciones ya no viven acá.** `flow`, `engine`, `domain-model`, `diccionario` y `plantillas`
eran prototipos que Miguel armó para entender
él mismo el negocio: **no están validadas contra el código** y varias describen un *deber ser*, no lo
que corre en producción. *(Con ellas se fueron `ingles` y `escriba`, que ni siquiera hablaban de CreditOp:
eran para practicar inglés y ortografía.)* *(Acá también estaba
`cuadrilla`. Ya no: el 2026-09-10 se mudó al repo compartido —`github/playground/tools/cuadrilla`,
rehecha en Go + Vue— y ahí dejó de ser una exploración: cumple el contrato del repo y tiene pruebas.
`make cuadrilla` sigue abriéndola.)* *(Las siete salieron del repo el 2026-09-24: Miguel las movió a
`~/Desktop/CREDITOP/temp/`, fuera de git.)* **No las cites como fuente ni las uses para decidir.** Si algo de ahí resulta
cierto, se verifica contra el código y gradúa a canon — hasta entonces, no existe para tu tarea.

**Reglas de la partición** (para que no se vuelva a mezclar): canon **no** lleva temas-tarea. El
enlace es **unidireccional** — la tarea apunta a temas (`canon:` en su frontmatter); el tema nunca
apunta a tareas, porque quedaría mintiendo al graduar — y además lo lee el equipo, que no tiene este
repo. Y del `.md` de una tarea **solo**
`jira_title` + la sección `## Tarea (publicable)` salen a Jira (pasan el guard); todo lo demás es
privado y puede nombrar repos, rutas y F-xx. El error de enrutar mal se comete por **fricción**, no
por no entender la regla — hoy los dos destinos cuestan lo mismo: un archivo markdown.

⚠ **Y «privado» no es «lo mismo pero más largo».** Dentro de la tarea hay CINCO piezas con cinco
públicos: el título es lo único compartido; el cuerpo explica *cómo se está atacando* (los caminos
evaluados, incluidos los descartados); la pila de bloques guarda los hechos con fecha que la prosa deja
envejecer; la bitácora dice en qué se fue el tiempo; y la publicable tiene **dos mitades** —producto
(*En una línea · Por qué · Qué cambia · Alcance*) y QA (*Dónde probar · Cómo validar · Criterios de
aceptación · Dependencias*)— para que QA no tenga que preguntar. La plantilla ya existe en el repo; el
detalle y lo medido que lo justifica: `tablero/CLAUDE.md` §«CINCO piezas». Ojo con el atajo de resumir
el cuerpo y pegarlo en la publicable: son otra pregunta y otro lector, y sale detalle técnico que a
producto no le sirve.

## El contexto se mide contra `main`, y lo que no está en main NO entra

Canon describe **lo que corre**, y la vara es `main`. Eso no es una costumbre: es una regla de
admisión escrita (`skills/dictar.md`) y el motivo por el que **un PR sin mergear no se dicta** —
mientras no esté en `main` no es «cómo funciona CreditOp», es una intención, y el equipo entero la
leería como un hecho. El protocolo completo —qué entra, cómo se declara la fuente, qué hace la
compuerta del banco de preguntas— vive en las `skills/` del repo de canon.

⚠ Y lo que sí es de este repo: `grep -rn "PENDIENTE DE MERGE" .` sigue siendo útil para las tareas del
tablero, donde una nota sobre algo sin mergear es legítima y hay que revisarla después de cada merge.

## Git

- **Este repo** (`playground`) se trabaja directamente sobre `main` y se commitea local. No crees ramas
  para sus mejoras. El push lo decide Miguel — no pushees por tu cuenta.
- **Los repos reales** (`legacy-backend`, `frontend-monorepo`, `legacy-application`) trabajan en ramas y
  stashes locales. **No armes PRs ni pushees ahí sin pedir permiso explícito.**
- **UN PR por tarea y por repo, con TODO lo que la tarea toque de ese repo.** No un PR por cambio ni
  por concern: si mientras arreglás algo aparece otra cosa de la misma tarea y del mismo repo, va en el
  MISMO PR. Ya se decidió una vez —2026-09-14, se cerró el #998 dentro del #997— y el motivo es el
  costo de revisión: cinco PRs chicos de la misma tarea se revisan cinco veces y se mergean en cinco
  momentos distintos, así que `main` pasa por estados que nadie probó. La única división que se
  mantiene es **por repo**, porque un PR no puede cruzarlos.
- ⛔ **La descripción de un PR NO nombra las herramientas internas.** Nada de `harness`, `trazador`,
  `tablero`, `connectors`, `playground` ni sus comandos `make`: el PR lo leen personas que no
  tienen ese repo y para quienes «corrí `make harness-walk-wizard`» no es evidencia, es ruido. Lo que va en
  el PR es **qué se midió y qué dio** —el ambiente, el caso, los números, el antes y el después— y las
  rutas del repo que se está tocando. El comando que lo reproduce va en el archivo de la tarea, que es
  privado y donde sí se puede nombrar todo. Misma regla que la bitácora, que sube a Jira y tiene su
  propio guard.

## Entorno local

- Hay una **copia local de la BD** en Docker: contenedor `legacy-backend-mysql-1`, schema `creditop`.
  Usala para verificar contra datos reales en vez de suponer.
- **`E2E_TARGET` por defecto es `dev`**, no `local` (`harness/pkg/db.ts:12`). Cualquier consulta o
  script que lo omita pega contra el **dev compartido**. Para local, exportalo:
  `E2E_TARGET=local`. (`dev/sweep.ts:34` y `dev/listing.ts:29` lo fuerzan; el panel setea
  `I_KNOW_THIS_TOUCHES_SHARED_DEV` cuando el target es `dev`.)
  ⚠ **Y ese «ya lo fuerza» fue FALSO hasta el 2026-09-09, en los dos runners.** Arriba del `||=`
  tenían un `import` **estático** que arrastraba `pkg/db.ts` → `pkg/env.ts`, donde `TARGET` se
  resuelve al evaluar el módulo — y los imports estáticos corren **antes** de la primera sentencia del
  archivo. Los dos imprimían «target local» y pegaban contra el RDS compartido. Arreglado pasándolo a
  import dinámico; la lección generaliza: **un `||=` de variable de entorno nunca gana a un import
  estático**. Es **F-187**.
- El harness del wizard se maneja desde el **panel**: `cd harness && npm run dev`. Los `bin/` son
  plumbing, no una segunda entrada.

## Trampas que ya costaron tiempo

- En `user_requests`, el estado de la solicitud es **`user_request_status_id`**, no `status`. Mirar la
  columna equivocada hace creer que una solicitud cancelada está sana (F-50).
- **El estado 11 es «Autorizada», y ES terminal**: medido en prod, de 10.182 solicitudes que lo
  tocaron en 90 días **3** avanzaron. El catálogo tiene estados posteriores (5 «Desembolsada», 20, 28,
  30) pero el desembolso y la cartera se llevan en otro lado. **No cuentes desembolsos con esa columna** — pero desde el **2026-09-18 sí hay una que sirve: `user_requests.disbursed_at`**, que llena un trigger de MySQL la primera vez que la solicitud pasa a autorizada (medido: 114.546 de 560.727 filas, desde 2023). ⚠ El histórico está **reconstruido**, y ~23% salió de `updated_at` como proxy porque las entidades que cambian el estado por webhook no dejan record. El detalle y sus cuatro trampas: nodo `db-routines`.
- ⚠ **`make trazador-acceso` es una SONDA: te muestra una MUESTRA.** Con `-limit 200` trae 200 líneas
  e **imprime cuatro**, y las cuatro se ven idénticas a doscientas. Contarlas dio «46% de los errores
  son del profiler» cuando el número real era **9,2%**. Para contar, la expresión métrica:
  `QUERY='sum(count_over_time({service_name="x", level="error"} [24h]))'`.
- `playground/docs/` **fue borrada** de `main` (absorbida por el árbol de contexto, que a su vez
  graduó a canon). Toda ruta `docs/X.md` que veas citada es histórica: `git show 159906a:docs/<archivo>`.

## Dos reglas de honestidad

- Si tocaste las `fuentes` de un tema de canon, validá que existan en `main` — una ruta mal escrita no
  falla en ningún lado: la lee un modelo y abre un archivo inexistente. Lo mismo con las citas
  `archivo:línea` de una trampa: `make trampas` las ancla por contenido y dice cuáles se corrieron.
- **Nunca afirmes como verificado algo que no comprobaste contra el código.** Si no lo miraste, decilo.

## Variables de entorno

**Las credenciales de un servicio viven en UN lugar: su conector** (tarea #90, desde el 2026-09-24).

| archivo | qué lleva |
|---|---|
| `connectors/.env.<target>` (`local` · `dev` · `qa` · `staging` · `prod`) | lo que depende del ambiente: la base (MySQL directo, o Redash en prod), Loki y PostHog |
| `connectors/.env` | lo que no: Gemini, Atlassian (Jira y Confluence, **un token para los dos**), Slack, Jev, Twilio y Figma |
| `<herramienta>/.env[.<target>]` | sólo las **perillas** de esa herramienta: Cognito, mocks, `SEED`, el board de Jira, a quién avisarle en QA |

La plantilla de los dos primeros es `connectors/.env.example`. Prioridad: **el proceso gana** sobre el
archivo, y una variable vacía en el proceso no tapa la del archivo. El trazador no tiene `.env` propio;
el tablero y el harness guardan sólo sus perillas. Desde otro lenguaje se llega por **`bin/pg`**
(`bin/pg help`, o `make pg ARGS='…'`). Un binario encuentra `connectors/` subiendo desde donde lo
corren, después desde donde vive (así un servidor MCP arranca aunque Claude lo lance desde otro lado) y
por último en `PLAYGROUND_ROOT`.

- ⚠ **La única excepción es la base del HARNESS** (`E2E_DB_*` en `harness/.env.<target>`): el harness
  siembra, o sea ESCRIBE, y la escritura no pasa por el conector a propósito — mezclaría la herramienta
  más riesgosa con la más usada.
- Las claves de base van **con el prefijo `E2E_DB_`**, nunca como `DB_HOST`: ese nombre es el que lee
  Laravel, y el conector no lo lee ni del archivo ni del proceso (CORE-431).
- ⚠ **Una copia de una credencial es una credencial que vence sin avisar.** Medido al unificarlas: el
  token de Confluence del `.env` de la raíz estaba vencido —Confluence contestaba 404, no 401— mientras
  el de Jira, del mismo sitio y la misma cuenta, servía para los dos. Y el `LOKI_ENV=qa` que traían los
  `.env` de staging y qa no existe en el stack. Antes de agregar una clave a una herramienta, fijate si
  su conector ya la resuelve.

**Qué rama sirve cada target:** `local` → local · `dev` → **develop** · `staging` → **la rama
`staging`**. *(Acá decía «`staging` → qa». Está mal: se fueron sumando ambientes para poder probar,
pero **el real es `staging`** — corregido por Miguel el 2026-08-14. El workflow lo confirma:
`main-stg.yaml` dispara con push a `staging` y despliega el servicio `legacy-backend-stg`.)*

⚠ `staging` comparte la **BD con `dev`** — es la misma (`inertia-dev`), confirmado el 2026-08-15 por
el contador `AUTO_INCREMENT` de `user_requests`: una solicitud creada desde staging aparece ahí. Si
las credenciales rotan, actualizá las dos. Pero **NO comparten backend** — el detalle de los dos
servicios del cluster y cómo saber qué rama te respondió: `harness/CLAUDE.md` §«Qué es real en cada
target».

⚠ **El `APP_ENV` de `staging` está EN DISPUTA, y no conviene apoyarse en él.** Acá decía que corre con
`APP_ENV=development`, deducido de que el bypass de OTP de QA funcionaba ahí y ese exige
`local`/`development` (2026-08-14). **El código dice otra cosa**: verificado contra `main` el 2026-09-07,
los cuatro ambientes que no son producción construyen la imagen con **`APP_ENV=develop`** —así lo pasan
`main-dev.yaml`, `main-qa.yaml`, `main-stg.yaml` y `main-lab.yaml`—, el Dockerfile convierte ese
argumento en la variable del contenedor, y **`APP_ENV=development` no aparece ni una vez en la historia
de esos workflows** (`git log -S` devuelve cero). Y `develop` no es `development`: la comparación de
Laravel es de cadena exacta.

Con `develop`, el bypass de OTP devuelve falso en su primera línea y la comparación de nombre del KYC
vuelve a ser estricta. Las dos observaciones no encajan, y la explicación posible es que el secreto del
servicio pise `APP_ENV` en tiempo de ejecución, que no se lee desde el repositorio.

**La regla práctica hasta que alguien lo mida en el servicio: NO des por apagado nada en staging.** Ni
el OTP, ni la validación de nombre del KYC, ni ninguna otra condición
`app()->environment(['local','development'])`. Comprobá el valor efectivo antes de armar una prueba
encima. Y al revés, un `config('app.env') === 'staging'` (hay uno en `InitialFeePaymentService`)
tampoco dispara con ninguno de los dos valores.

**Los permisos no van en archivo.** El flag `I_KNOW_THIS_TOUCHES_SHARED_DEV` **no** vive en ningún
`.env.*`: se exporta a mano en la shell cuando de verdad vas a escribir a la BD compartida de dev (el
panel lo inyecta solo para sus corridas). Meterlo en un archivo desarma la guarda (F-53).

`.env.*` está gitignoreado (trae secretos); las plantillas versionadas y documentadas son
`connectors/.env.example` y `<herramienta>/.env.<target>.example`.
