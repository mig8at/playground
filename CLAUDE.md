# CREDITOP · playground

Espacio propio de Miguel: organiza el conocimiento de **CreditOp** (fintech colombiana de originación
de crédito) y agrupa las herramientas de prueba. Existe para que un modelo entienda **antes** de atacar
una tarea.

## `make` es la puerta única

`make` sin argumentos lista todo lo que se puede correr, agrupado por para qué sirve. No hace falta
recordar en qué carpeta vive cada script — ni correr `make`: el hook `SessionStart`
(`.claude/hooks/herramientas.py`) inyecta ese catálogo al arrancar, al reanudar y **después de
compactar**. Por eso acá **no hay lista de comandos**: la que había era una copia a mano que quedaba
vieja (llegó a anunciar un target `qa` que no existe). Lo que va acá es lo que `make` no puede decir:
**cuál elegir, y contra qué ambiente**.

⚠ **Antes de decir «no tengo acceso a eso», mirá el catálogo.** Loki, Redash, las cuatro bases de
datos, PostHog y Confluence ya están cableados y con credenciales. El error caro no es no tener la
herramienta: es suponer que no está y contestar de memoria.

### Qué herramienta según qué estás preguntando

| Tu pregunta | Con qué se contesta |
|---|---|
| **no conozco el dominio, ¿por dónde empiezo?** | `workers/cli.py negocio` — los 23 conceptos en orden, con el nodo que explica cada uno |
| **¿cómo funciona X?** | `context/` — no es una herramienta: `docs/ROUTE-MAP.md` → nodo. **Siempre primero** |
| **¿ya nos pasó?** | `context/server/data/flows/findings/doc.md`, entrando por su índice de síntomas |
| **¿por qué existe esta regla?** (política, contrato, qué se le ofreció al comercio) | `make confluence` — el porqué del negocio no está en el código |
| **…y si `context/` no lo cubre** | `workers/` — el índice se deriva de `main`, así que cubre TODO el código, incluido lo que nadie escribió (ver abajo) |
| **¿qué archivos toco para esto?** | `workers/cli.py buscar "…"` — describís en palabras, te da archivos con el porqué |
| **¿cómo está construido este repo?** | `workers/cli.py repos <alias>` · `subramas` · `mapa` — entra POR REPO, no por síntoma |
| **¿por qué este comercio/lender se porta distinto?** | `workers/cli.py quemado` — los lugares donde el código decide por IDENTIDAD y no por config, con cada id resuelto a su nombre. ⚠ indexado por (columna, id): `24` es Credifamilia como lender y *Creditop* como comercio |
| **¿por dónde empiezo a pagar esa deuda?** | `workers/cli.py cobertura` — cruza esos 391 lugares contra lo que canon declara y contra su PESO (commits de 90 días). ⚠ medido: canon cubre el 49%, pero de los `id_quemado` —los que atan una conducta a UNA entidad— queda fuera el **76%**, y de los `despacho` el 100% |
| **voy a indagar en los repos, ¿cómo no perder el día?** | `workers/INDAGAR.md` — el método: demanda → índice → verificación contra `main` → ¿se alcanza/es la norma/se ejecuta? → causa → mecanismo. ⚠ cada regla de ahí costó un error, incluido el mío |
| **¿quién es esta entidad, en negocio?** (a cuántos comercios llega, qué ticket, qué plazo, cuánto aprueba, dónde se cae la gente) | `context/docs/ENTIDADES.md` — **generado** contra **prod** con `make context-entidades`. ⚠ dice lo que las entidades HACEN, no lo que son |
| **¿con qué se une esta tabla?** · **¿qué tablas toco para X?** | `workers/cli.py relaciones` — las 247 en 13 vecindarios. ⚠ el esquema declara **44** FK: las otras 388 relaciones están reconstruidas y cada una dice de dónde salió |
| **¿quién llama a esto?** · **¿difieren los dos monolitos?** | herramientas de los agentes (`quien_usa`, `gemelos`); a mano, `workers/cli.py gemelos` |
| **hay MUCHO código que leer para contestar** | `make agente-analisis PREGUNTA='…'` — plan → N buscadores → lector de 300k. La receta: `workers/README.md` §«Cómo se orquesta» |
| **¿esto pasa de verdad, y cuánto?** | `make trazador-sql` contra **prod**. Es la única forma de contestarlo. Con agente: `make agente-datos TARGET=prod` |
| **¿qué le pasó a ESTA solicitud?** | **Dos forenses, y la diferencia es dónde ANCLAN.** `make trazador-ureq UREQ=…` arranca en la BD —las etapas son hechos, salen aunque no haya un solo log— y suma los 39 pasos, qué VIO el cliente y qué archivos dejaron rastro; es la única que llega a **prod**. `make harness-loki UREQ=…` arranca en los LOGS y por eso trae lo que la otra no: la regla con la que se evaluó cada entidad y el `timeline.ndjson` completo con payloads — pero sin líneas no puede decir nada, y **no mira prod**. ⚠ Sus defaults son OPUESTOS (`local` vs `prod`): escribí `TARGET=` siempre, o cambiás de ambiente sin enterarte (F-234). Cada una imprime el comando de la otra al terminar. Si sólo tenés la cédula o el celular, `make trazador-buscar Q=…` primero. ⚠ `trazador-acceso` **no** es esto: es la sonda de «¿puedo leer los logs?» |
| **leí un error, ¿de qué archivo salió?** | `workers/cli.py logs "<mensaje>"` — el mapa va del mensaje al archivo y su línea. Para una corrida entera, la herramienta `archivos_de_la_traza` del agente que mide |
| **¿qué VIO el cliente en pantalla?** | `make trazador-posthog UREQ=… TEL=…` — ⚠ **sin `TEL` ves la mitad**: la fase de AUTH ocurre antes de que exista la solicitud, así que PostHog la identifica por teléfono (medido: 47.792 eventos por teléfono contra 24.006 por solicitud) |
| **¿qué entidades le salen a ESTE comercio, y por qué no las otras?** | `make harness-listado COMERCIO=…` — **3 s**, por API y sin browser. `context/` explica la CASCADA; esto contesta el CASO |
| **¿qué pasa si el cliente es así?** (ingreso, score, ocupación, plazo, entidad) | `make harness-caso CASOS='…'` — el flujo entero por API, en paralelo. `CERRAR=1` llega hasta el desenlace |
| **¿esta regla de verdad excluye, o sólo reordena?** | corré el caso con y sin el dato. Una regla que «debería» excluir y no excluye es el error más caro del dominio (F-162) |
| **¿funciona, corriéndolo?** | `harness` (`make panel`) es el camino VISUAL, de Miguel. **El tuyo es por consola**: `harness-caso` · `harness-listado` · `harness-suite` |
| **¿en qué anda el equipo?** | Slack (MCP) · `make cuadrilla` · `make tablero` |

⚠ **Y hay preguntas que NO se contestan leyendo — se contestan corriendo.** `context/` describe el
**mecanismo**, que generaliza; una corrida describe **el caso**, que no. Los dos hacen falta: la corrida
sin el mecanismo no se sabe interpretar, y el mecanismo sin la corrida no dice qué pasa con este
comercio. Medido el 2026-08-23 con la misma pregunta por los dos caminos: correrlo tardó **3 s** y dio
las 7 entidades con su `response_type`; leerlo eran **4 nodos y ~9.000 palabras**, y **ninguno nombra <!-- lint:ok -->
ese comercio** — porque no es su trabajo.
⚠ **Y lo más importante: correr ENCUENTRA lo que leer no puede.** De los **12 hallazgos** agregados el <!-- lint:ok -->
2026-08-23 (F-163…F-174), **11 salieron de una corrida** — el único que salió de leer código fue F-170,
y lo disparó una pregunta. Un flujo que se rompe con la entidad ya elegida, un webhook que rechaza
siempre, una subida que falla en silencio: nada de eso está escrito en ningún lado hasta que alguien lo
corre.

⚠ **El silencio de `context/` NO es «no existe».** El árbol sólo sabe lo que alguien escribió, y su
hueco se lee igual que una ausencia real. Medido el 2026-08-16: dos funcionalidades mergeadas —el
endpoint de regeneración de Credifamilia (13/8) y el flag `can_check_preapproval` (10/8)— no estaban
en ningún nodo. **Cuando el árbol no diga nada de algo que debería existir, no concluyas: preguntale
a `workers/`, que se deriva del código.**

Regla de oro: **una afirmación verificable se verifica antes de escribirla**, y la herramienta que la
verifica casi siempre existe ya. Y cuando la verificás, **la anotación no se escribe a mano**: el
trazador la emite con `MD=1` (`trazador-ureq` · `trazador-buscar` · `trazador-sql`), con la fecha real y
el comando que la reproduce adentro — que es lo que hace que la medición se pueda desmentir mañana. Y la salida de un agente **también se verifica** —contra `main`, con
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
los zod reales), y lo que ahora hacen dos cruces más: `workers/logs.json` —el índice de los mensajes
que el código emite— valida los matchers del mapa del trazador, y encontró **cinco mudos** por una
renumeración; y el emisor de anotaciones del arnés se prueba leyendo el **regex real** de
`store.Anotaciones`, en el repo del tablero. ⚠ La regla es la de los mocks: **una herramienta no puede
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

### Las cuatro UIs comparten UN tema, y es un archivo

`context` (:5193), `harness/panel` (:5195), `tablero` (:5191) y `trazador` (:5192) tenían cuatro
paletas escritas a mano, con **cuatro nombres para el mismo concepto** —el texto apagado era `--dim`,
`--mut` y `--mut`; el acento era `--accent`, `--acc` y `--acc`; el rojo era `--fail`, `--bad` y
`--danger`—, así que no había forma de cambiarles el aspecto sin tocar las cuatro. Hoy:

- **`tema.css` es el archivo que se cambia, y es el MISMO en las cuatro** (`context/src` ·
  `harness/panel` · `tablero/src` · `trazador/src`). Es un export de [tweakcn](https://tweakcn.com/)
  tal cual: elegís un tema ahí, copiás su bloque y **pisás el archivo**. Nada más. No se edita a mano
  y no lleva ni una regla propia de ninguna herramienta.
- **`make estilo-check`** es lo que hace que eso sea cierto y no una intención: compara los md5 de los
  cuatro, prohíbe las mezclas `in oklch`, mide el contraste de las reglas que fijan color y fondo, y
  lista las variables usadas y nunca declaradas. Corrélo después de tocar estilos.
- Cada herramienta tiene, al lado, **su propia hoja con el PUENTE**: sus nombres viejos apuntando a
  los tokens (`--bg: var(--background)`, `--mut: …`) y lo que sólo significa algo ahí —el estado de una
  etapa, el carril de un ramal, el semáforo de un scorecard—. **Ese color semántico NO va en `tema.css`
  a propósito**: un export de tweakcn no lo trae, así que pegar un tema nuevo encima lo borraría.
- Las tres apps de Vite además tienen **Tailwind v4** enchufado (`@tailwindcss/vite`), con los tokens
  ya mapeados a utilidades por el `@theme inline` del tema. ⚠ Las utilidades van en `@layer
  utilities` y **el CSS sin capa —todo lo que ya existe— les gana**: sirven para markup nuevo, y para
  migrar un bloque hay que borrarle la regla, no competirle. El panel del harness **no** tiene
  Tailwind: no tiene bundler (`npm run dev` es `node panel/server.ts`), así que consume el mismo
  `tema.css` por `<link>` y listo.

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

Hermano de lo anterior, y el mismo mecanismo: **`taller.css`, idéntico en las cuatro**, al lado de
`tema.css`. El tema dice de qué COLOR es cada cosa; el taller dice QUÉ COSA ES. Son dos ejes y por eso
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
  (`sidebar` el árbol, `editor` el detalle) · el trazador una (`auxiliarybar`). `make estilo-check` lo
  lista, así que se ve de un vistazo quién adoptó qué.
- **Una región puede tener VARIAS VISTAS apiladas** (`.view`), como el sidebar primario de VS Code:
  el árbol arriba y OUTLINE/TIMELINE colapsadas abajo. ⚠ **Una vista cerrada cuesta UNA FILA, no
  cero** — es la misma regla que el canal deshabilitado del panel del harness: verla apagada dice que
  existe y que ahora no corresponde; esconderla hace creer que no existe. Y ⚠ **no todo lo que se
  pliega es un `.view`**: esto es para vistas que se reparten el alto de una región de alto fijo. Para
  secciones dentro de un cuerpo que scrollea, el elemento correcto es `<details>`, que no necesita JS
  (el panel del harness ya tiene ocho así).
- **El encabezado de una región lleva barra de acciones y menú `⋯`**, como el Explorer de VS Code, y
  la división es lo que lo hace funcionar: en la **barra** lo que se HACE y es frecuente (iconos
  siempre a la vista); en el **menú** lo que se ALTERNA y se toca poco, con su tilde y su conteo.
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

⚠ **Y la colisión que hubo que resolver primero, que es el mismo error de `--accent`:** en VS Code
`panel` es **la consola de abajo**, y en las cuatro herramientas `--panel` era un **color** (la
superficie de card) mientras `.panel` era un cajón. Tres significados para un nombre. Hoy el color es
`--card` (que ya venía del tema), los cajones son `.drawer`, y `panel` significa una sola cosa.

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
completo: `tablero/data/tests-pueden-borrar-la-bd-compartida.md` (CORE-431) y su documento de arranque
en `data/artifacts/…hipotesis.md`.

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

**Desde el 2026-09-14 esto NO depende de acordarse: `.claude/hooks/tests-destructivos.py`** (PreToolUse
sobre Bash) frena la suite sin ruta, el `fresh`/`wipe` de la base, el `test` del Makefile de
legacy-backend, y una ruta que arrastre `RefreshDatabase` en cualquiera de sus tres formas — sólo para
comandos que hablen de legacy-backend, y mirando la POSICIÓN DE COMANDO (nombrar la palabra en un
commit o un grep no frena). Si de verdad querés recrear tu base local, el comando lleva
`I_KNOW_THIS_RECREATES_MY_LOCAL_DB=1`. La lista de abajo sigue valiendo fuera de una sesión con hooks
(la terminal, el editor).

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

Se viene a resolver **tareas** sobre CreditOp con cinco piezas — **tablero** (la tarea), **context**
(el conocimiento curado), **workers** (el índice derivado del código, para lo que el conocimiento aún
no cubre), **harness** (la prueba) y **trazador** (lo que ya pasó, incluido en prod) — y el circuito es
fijo.

⚠ **Y cada una tiene un lugar propio DENTRO del archivo de la tarea.** El `CLAUDE.md` de las cuatro que
no son el tablero cierra con una sección «Qué deja esto en la tarea», y
[`tablero/CLAUDE.md`](tablero/CLAUDE.md) §«De dónde sale lo que se escribe acá» es su espejo. Sin eso
la información se escribe igual, pero suelta en la prosa, donde nadie la encuentra al retomar: medido
el 2026-09-18, **43 de 68 tareas nombran `context` y sólo 40 declaran `context_nodes`**; el arnés
aparece en 33 y **sólo 8 lo nombran dentro de «Cómo se comprueba»**.

1. **La TAREA vive en `tablero/data/<tarea>.md`** (una tarea = un archivo): en qué se trabaja, por
   qué y para qué — estado, decisiones, riesgos, preguntas abiertas.

   ⚠ **Buscá el archivo que YA cubre esto antes de crear uno: `make tareas TODAS=1`.** El `id` del
   frontmatter es lo que hace visible una tarea en el tablero: **`id: 0` no tiene tarjeta**, ni botón de
   bitácora, ni cajón de ramas. Escribir el avance ahí es escribirlo donde nadie lo mira — pasó el
   2026-08-27 y el tablero mintió ocho días mientras se mergeaban PRs.

   ⚠ **Y al cerrar la sesión son CUATRO cosas, no una:** reescribir el estado de arriba · apilar la
   entrada del Registro · declarar `ramas:` y volver a medir con `make tareas-ramas` · escribir la
   bitácora en `tablero/data/entries/` **con minutos medidos** (`make pulso`, o el lapso de commits), no
   estimados. **`make cierre` chequea las cuatro** y el hook de `Stop` lo corre solo. El detalle y lo
   medido que lo justifica: `tablero/CLAUDE.md`.
2. **El CONTEXTO se lee ANTES de investigar.** `context/docs/ROUTE-MAP.md` es el índice (generado,
   validado contra `main`); abrí los que matcheen: `context/server/data/flows/<id>/doc.md` (el
   análisis) + `map.json` (las rutas fuente exactas). El código real vive **fuera**, en
   `~/Desktop/CREDITOP/github/` (`legacy-backend`, `frontend-monorepo`, `legacy-application`,
   `pre-approvals-service`) — grandes: entrar por grep sin mapa es la forma lenta.
3. **Lo que se descubre SE REGISTRA, con dos destinos.** El test: *si esto se mergea mañana, ¿el
   texto sigue siendo cierto?*
   - hallazgos **de la tarea** (avance, decisiones, riesgos, preguntas) → su `.md` del tablero;
   - trampas **del sistema**, verificadas (síntoma → causa raíz → evidencia → arreglo) →
     `context/server/data/flows/findings/doc.md` (F-01…). **Mirala antes de depurar un muro**: si
     ya nos pasó, está ahí.
4. **Probar de verdad es `harness/`** (panel, runners, mocks): se comprueba **corriendo**, no
   leyendo. Una afirmación que se puede verificar ahí se verifica **antes** de escribirla como cierta.
   ⚠ **Y en local/dev/staging las centrales de riesgo NO las atiende el proveedor**, sino un lambda de
   mocks de la empresa (`Creditop-SAS/risk-services-mockery-lambda`, un Mockoon; no está entre los
   repos de arriba). Se le puede **dictar la respuesta por cédula** — la receta, con sus trampas, en
   `tablero/data/mocks-de-centrales-un-solo-mecanismo.md`. Sin saber esto, una prueba de identidad ahí
   siempre devuelve la misma persona y parece que el código está roto.
5. **Al mergear, GRADÚA:** lo mergeado deja de ser tarea y pasa al nodo de contexto — ahí es "cómo
   funciona CreditOp". La tarea se marca `archived` en su frontmatter. Ejemplo hecho: la omisión de
   Experian por cupo ya confirmado vive hoy en el nodo `kyc`.

### Y lo que mergea OTRO — el bucle para que el árbol no quede viejo

El paso 5 cubre lo que mergeás vos. Lo que mergea el resto del equipo entra sin que nadie lo escriba, y
el hueco no avisa. **El bucle, probado el 2026-08-16 y que encontró dos funcionalidades invisibles:**

1. `make context-align` — qué nodos quedaron viejos. Y `make context-diff NODE=x` — **qué cambió** en
   el código de uno. ⚠ Los dos aportan cosas distintas: Credifamilia salió de la deriva (un archivo
   repitiéndose en la de VARIOS nodos), y `can_check_preapproval` salió del diff de un nodo con deriva
   **baja**. Mirar sólo el ranking de deriva se pierde lo segundo.
2. Confirmá que el hueco es real: `git log main --oneline -- <ruta>` (cuándo entró y quién) + un grep
   en los `doc.md`. Si nadie lo menciona, ahí hay algo.
3. Preguntá. `make agente-analisis PREGUNTA='…'` si hay mucho que leer; a mano si son 3 archivos.
4. **Verificá contra `main`** lo que devuelva, y recién ahí escribilo en el nodo + su `map.json`.
   Validá con `python3 tools/oracle.py`, `make context-lint` y `tools/refs.py <nodo>`.
5. **NO sellés el nodo** por haber agregado una sección: sellar dice «lo revisé entero». El método de
   re-verificación completo está en `context/CLAUDE.md`.

⚠ **El resto de carpetas NO son herramientas para contextualizarte** — hoy: `flow`, `engine`,
`domain-model`, `diccionario`, `plantillas`, `creditop-woocommerce`. Son exploraciones que Miguel armó para entender
él mismo el negocio: **no están validadas contra el código** y varias describen un *deber ser*, no lo
que corre en producción. *(Y `ingles` no habla de CreditOp en absoluto: es para aprender inglés.)* *(Acá también estaba
`cuadrilla`. Ya no: el 2026-09-10 se mudó al repo compartido —`github/playground/tools/cuadrilla`,
rehecha en Go + Vue— y ahí dejó de ser una exploración: cumple el contrato del repo y tiene pruebas.
`make cuadrilla` sigue abriéndola.)* **No las cites como fuente ni las uses para decidir.** Si algo de ahí resulta
cierto, se verifica contra el código y gradúa a `context/` — hasta entonces, no existe para tu tarea.

**Reglas de la partición** (para que no se vuelva a mezclar): el árbol de context **no** lleva
nodos-tarea. El enlace es **unidireccional** — la tarea apunta a nodos (`context_nodes`); el nodo
nunca apunta a tareas, porque quedaría mintiendo al graduar. Y del `.md` de una tarea **solo**
`jira_title` + la sección `## Tarea (publicable)` salen a Jira (pasan el guard); todo lo demás es
privado y puede nombrar repos, rutas y F-xx. El error de enrutar mal se comete por **fricción**, no
por no entender la regla — hoy los dos destinos cuestan lo mismo: un archivo markdown.

⚠ **Y «privado» no es «lo mismo pero más largo».** Dentro de la tarea hay CINCO piezas con cinco
públicos: el título es lo único compartido; el cuerpo explica *cómo se está atacando* (los caminos
evaluados, incluidos los descartados); las anotaciones con fecha guardan los hechos que la prosa deja
envejecer; la bitácora dice en qué se fue el tiempo; y la publicable tiene **dos mitades** —producto
(*En una línea · Por qué · Qué cambia · Alcance*) y QA (*Dónde probar · Cómo validar · Criterios de
aceptación · Dependencias*)— para que QA no tenga que preguntar. La plantilla ya existe en el repo; el
detalle y lo medido que lo justifica: `tablero/CLAUDE.md` §«CINCO piezas». Ojo con el atajo de resumir
el cuerpo y pegarlo en la publicable: son otra pregunta y otro lector, y sale detalle técnico que a
producto no le sirve.

## El contexto se mide contra `main`, y lo que no está en main se marca

`context/` describe **lo que corre**, y la vara es `main`. Lo que todavía no mergeó se marca inline con
`⏳ PENDIENTE DE MERGE` justo donde engaña (`grep -rn "PENDIENTE DE MERGE" context/` las lista todas;
revisala después de cada merge). El protocolo completo de curación —la marca, los sellos, el oráculo,
qué hacer al cerrar una tarea— vive en **`context/CLAUDE.md`**.

## Git

- **Este repo** (`playground`) se commitea local. El push lo decide Miguel — no pushees por tu cuenta.
- **Los repos reales** (`legacy-backend`, `frontend-monorepo`, `legacy-application`) trabajan en ramas y
  stashes locales. **No armes PRs ni pushees ahí sin pedir permiso explícito.**

## Entorno local

- Hay una **copia local de la BD** en Docker: contenedor `legacy-backend-mysql-1`, schema `creditop`.
  Usala para verificar contra datos reales en vez de suponer.
- **`E2E_TARGET` por defecto es `dev`**, no `local` (`harness/pkg/db.ts:12`). Cualquier consulta o
  script que lo omita pega contra el **dev compartido**. Para local, exportalo:
  `E2E_TARGET=local`. (`dev/sweep.ts:34` y `dev/listado.ts:29` lo fuerzan; el panel setea
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
- `playground/docs/` **fue borrada** de `main` (absorbida por `context/`). Toda ruta `docs/X.md` que veas
  citada es histórica: `git show 159906a:docs/<archivo>`.

## Dos reglas de honestidad

- Si tocaste rutas de un nodo, validá con `python3 context/tools/oracle.py <map.json>` — una ruta mal
  escrita no falla en ningún lado: la lee un modelo y abre un archivo inexistente.
- **Nunca afirmes como verificado algo que no comprobaste contra el código.** Si no lo miraste, decilo.

## Variables de entorno

Cada herramienta guarda su configuración por target en su propio **`.env.<target>`** (`local` · `dev` ·
`staging`), **autosuficiente**: ahí viven tanto los **hechos** del entorno (BD, API base, `APP_KEY`)
como las **perillas** (Cognito, mocks, `SEED`). Ya **no** hay capa compartida `env/` (se eliminó el
2026-07-22). Prioridad: `process.env` > `<herramienta>/.env.<target>`.

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
`<herramienta>/.env.<target>.example`.
