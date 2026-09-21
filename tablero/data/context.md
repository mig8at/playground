---
id: 89
title: "Context"
clase: proyecto
stage: work
created: "2026-09-19T08:00:00-05:00"
canon: []
ramas: canon/graduar-desde-context, canon/graduar-desde-context-2
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

✅ **`context/` ya no existe.** Se apagó el 2026-09-21: 34 nodos y 885 KB borrados, más su `src/`,
`dist/` y sus 16 herramientas. Lo que valía graduó a **canon** (el corpus compartido, en
`github/playground/tools/canon`), las trampas del sistema viven en `tablero/data/trampas/`, y las
cuatro herramientas que estaban ahí de prestado se mudaron a la carpeta que las usa. Esta tarea pasa
a ser el REGISTRO de cómo se hizo; lo que quede por hacer de contexto es de canon y va en su tarea.

Esta es la única tarea local de `context`. Los 39 nodos fueron re-verificados contra `main`; 38 están
sellados y `findings` permanece deliberadamente sin sello porque una validación parcial no debe
presentarse como revisión completa.

El laboratorio de Jev propone qué nodo leer mediante una preselección local y una decisión tipada.
Está apagado por defecto, guarda reportes fuera del corpus y conserva el mapa completo como
recuperación. La integración opcional de workers solo se usa con preguntas generales sin datos
personales. `brief --text` imprime la ficha en texto; es lo que consume `make retomar BRIEF=1` del
tablero, donde Jev no rutea nada porque la tarea ya declara sus nodos.

Tablero mantiene una consola inferior de ramas para la tarea enfocada. Su sidebar derecho enumera
sólo los repos asociados a las ramas de esa tarea y la tabla muestra rama, PR, ambientes y commit.
Esta tarea tiene la ruta estable `#/tareas/context`; al recargar vuelve a abrirla. El inventario
completo de repos permanece en la UI propia de Context; ambas lecturas salen de Git local y nunca
hacen `fetch` al renderizar.

**El próximo paso es:** **borrar**, no graduar. Con el barrido hecho, el orden es: (1) los nueve
nodos revisados que no cedieron nada —se van como se fue `bancolombia`, repartiendo lo operativo a
los `CLAUDE.md` y las preguntas abiertas a su tarea—; (2) los ocho estructurales, comprobando que
son catálogo; (3) los once de puro formato. Antes de cada borrado, redirigir sus punteros a canon
como se hizo con `corbeta` y `actors`. ⚠ Y queda decidir dónde va lo de `negocio`, que no es de
canon ni es inventario: es proceso comercial y su casa es Confluence. Y a `creditopx` le quedan **cuatro secciones que
PARECEN estar ya en canon**
—el ingreso que no decide, el motor del rotativo, el crédito activo que bloquea y «no apareció»—.
No se borraron sin compararlas: hay que leer las dos versiones y quedarse con la mejor, porque en
`backoffice` pasó dos veces que la de canon era más completa y una vez que la de acá tenía algo que
allá faltaba. Con eso el nodo se borra. Después, los 6 duplicados restantes.
⚠ El PR sigue **sin pushear**: son 8 reglas en 3 temas, y a partir de acá cada tema que se sume lo
hace más difícil de revisar. Conviene abrirlo pronto.

## Frentes activos

- **Vigencia:** repetir alineación y referencias después de cambios relevantes en los repos. Al
  re-verificar, `make context-diff NODE=x CITAS=1` antes de leer el diff; medir cuántas veces evitó
  leerlo entero.
- **Citas dentro de los `CLAUDE.md`:** al mover las secciones, sus `archivo:línea` salieron del
  alcance de `refs.py`, que sólo mira el árbol. Hoy nadie avisa si una se corre. Es el precio del
  retiro y conviene cerrarlo.
- **Clasificar la deriva:** la parte determinista ya está (`CITAS=1`) y dónde anotarla también
  (`context-triar`). Lo que falta antes de pensar en un modelo es la vara: un banco de cambios
  pasados etiquetado desde el historial — y triar a mano ya lo va llenando, porque cada veredicto
  escrito es una etiqueta real.
- **Ramas:** usar la consola en el trabajo diario y ajustar la clasificación si aparece un estado que
  la comparación actual no distingue.
- **Jev:** comparar calidad, abstenciones, latencia y superficie enviada al modelo generativo.
- **Findings:** mantener visible qué parte fue comprobada sin declarar revisado el nodo entero. El
  índice ya no se puede quedar atrás sin que el lint lo diga (`L9`).

## Cómo se comprueba

`make context-lint`, `make context-ramas`, `make context-ramas-test`, `make context-jev-test`,
`make context-jev ARGS='bench'`, `make estilo-ui` y las herramientas de alineación y referencias. Una
corrida Jev no verifica conocimiento ni renueva sellos.

## Registro

### 2026-09-21 · lo que el borrado rompió, y por qué apareció recién al final

⚠ **El Jev del TABLERO quedó roto por un archivo que no era suyo.** `tablero/tools/jev.py` importaba
`jev_transport.py` desde `context/tools/` —el transporte se llamaba «compartido» porque lo usaban los
dos laboratorios—, así que al borrar el árbol se fue con él. La prueba lo cazó en el acto
(`Ran 1 test … FAILED`), pero **la corrida anterior había dicho OK con 8 tests y yo no miré el
número**: el aviso estaba en el conteo, no en la palabra. Recuperado del historial y puesto donde
vive su único consumidor, la suite vuelve a 8. Y su `--env-file` apuntaba a `context/.env`, que
también se fue: ahora es el `.env` de la raíz.

**Lo demás que apuntaba al vacío y se reapuntó:** el texto que IMPRIME `make hoy` («gradúa a
context/»), el detalle que imprime `workers negocio`, la plantilla de tarea, `tablero/docs/
ARQUITECTURA.md`, el README del tablero (incluidos los enlaces «Contexto local», que abrían :5193) y
una docena de docstrings en `workers`. Las notas que dicen «vivía en `context/` hasta el 2026-09-21»
se dejan a propósito: son procedencia, no punteros.

### 2026-09-21 · el árbol se apagó

**Antes de borrar, la comprobación.** El barrido ya había clasificado los 34 nodos (15 revisados, 8
estructurales, 11 de puro formato), pero 20 no llevaban marca de destino en su texto. Se les
extrajeron las **120 secciones propias** y se le preguntó a canon por cada una. Todas las que no
matchean son la misma: **«Lo que NO está verificado»**, que es formato del árbol y que canon rechaza
por definición —su regla de admisión es lo que existe en `main`—. La única sustantiva fue «El dolor
en una frase» de `hardcodes-entidades`.

> **MEDICIÓN · 2026-09-21** — esa sección afirmaba que sumar una entidad con un flujo distinto
> **obliga a tocar tres repos** (`application` + `legacy-backend` + `frontend-monorepo`). Medido:
> son **DOS**. Los 409 lugares donde el código decide por identidad están en `legacy-application`
> (221) y `legacy-backend` (188); en el front, **cero** — y el escáner sí mira el front, con el
> patrón `lenderId === <n>`. ⚠ Lo honesto es «cero con ESE patrón», no «el front no tiene»: podría
> quemar por slug o por nombre. **Por eso la sección no graduó y no hace falta que gradúe**: la
> pregunta la contesta `workers/cli.py quemado` midiendo, y una copia en prosa sería un número
> horneado — justo lo que la compuerta de canon bloquea. Reproducible: `workers/cli.py quemado`.

**Lo borrado:** `context/` entero. Con él se van sus 14 comandos `make context-*`, el hook
`oraculo.py` (PostToolUse sobre los `map.json`), y **Jev**: su corpus era 100 % los nodos
—`tree.json` + `server/data/flows/*`, y no nombra canon ni una vez—, así que `route` y `brief` se
quedaron sin a qué rutear. Lo que hacía ya lo hace canon mejor y gratis. ⚠ El `tablero/tools/jev.py`
es OTRO y sigue: tría tareas, no toca el corpus.

**Lo que se arregló al pasar:** las cuatro herramientas de estilo enumeraban `context/src` y el
puerto :5193, así que habrían medido una carpeta inexistente; `ui-check.mjs` tenía **dos bloques de
pruebas y cuatro fixtures** de una UI que ya no existe; y el tablero arrastraba CSS muerto
(`.task-head-context`, `.ctx-link`) de un markup que se había ido antes. Las citas del mapa del
trazador al árbol quedaron marcadas como históricas, no colgando.

> **MEDICIÓN · 2026-09-21** — **el chequeo de citas encontró su primer caso real el mismo día en que
> se le permitió fallar.** Siete citas a `PramiController.php` estaban corridas: seis por +4 líneas
> (el commit `f4de10d2` del 17/9 le agregó una cabecera) y una porque `rejectWebhook` se movió de
> `:207` a `:332`. Con el chequeo viejo esto salía por pantalla y `make trampas` daba verde igual.
> Corregidas las siete; `make trampas` vuelve a 149 citas · 121 ancladas · 0 rotas.

⚠ **Y una del oficio, que costó un commit:** otra sesión commiteó sobre el mismo worktree mientras yo
trabajaba, y su `git commit` **se llevó mi `git rm -r context/` del índice** — el borrado entero
quedó dentro de `e985cfc6`, un commit cuyo mensaje habla de otra cosa. El contenido está bien y no se
reescribe la historia de otra sesión; la lección es la que ya estaba escrita y no apliqué hasta el
final: **stagear y commitear en el MISMO comando**, nunca en dos pasos.

### 2026-09-21 · la desconexión, paso 2: las puertas, los comandos y lo que no era del árbol

**Cuatro herramientas vivían en `context/` de prestado** y se mudaron con `git mv`, para que la
historia siga: `ramas.py` (la consola de repos DEL TABLERO) → `tablero/tools/` · `huella.py` (la
huella medida de una corrida) → `trazador/tools/` · `confluence.py` → `tools/` · `build-entidades.py`
y su `ENTIDADES.md` → `workers/`. Con ellas se movió el `.env` de las credenciales a la raíz.
Los comandos siguieron: `context-ramas` → **`repos`**, `context-huella` → **`trazador-huella`**,
`context-entidades` → **`entidades`**. ⚠ Y una trampa evitada al mover: el snapshot de `ramas.py` se
llamaba `ramas.json` y en el tablero ya había OTRO `data/cache/ramas.json` —las ramas por tarea, que
mide `make tareas-ramas`—; se renombró a `repos.json` antes de que alguien leyera uno por el otro.

**`make status` dejó de medir un árbol que va a desaparecer.** Ahora corre `make trampas` e imprime
el comando de la ronda de canon, que es donde está la vara de verdad (`go run . -ronda` compara los
hashes declarados contra `main`).

> **MEDICIÓN · 2026-09-21** — **`workers/` leía `context/` en CÓDIGO, no sólo en prosa**, y eso no
> estaba en la cuenta de la desconexión: cinco archivos importaban `roots` por `sys.path` y tres
> derivaban de los `map.json` del árbol el campo «qué nodo cita este archivo». O sea que borrar el
> árbol habría roto `workers/cli.py` —`negocio`, `puente`, `menu`, `buscar`— sin que ninguna de las
> listas que hice antes lo dijera. Reproducible: `grep -rn "context" --include='*.py' workers/`.

De ahí salieron dos piezas nuevas, las dos en la raíz porque las usan TRES directorios y no son de
ninguno:

- **`tools/repos.py`** — los repos de la compañía, la ref a mirar y el índice de «qué existe en
  main». Lo importan el tablero (citas, ramas), el trazador (huella) y `workers` (cinco archivos).
  Una sola copia, por la razón medida el 2026-09-18: de esa única lista leyendo el `main` local
  salieron cinco mentiras en cinco herramientas, y **ninguna falló** — todas devolvieron menos.
- **`tools/canon.py`** — leer el corpus compartido desde disco: qué tema declara cada archivo y cada
  tabla. Reemplaza al cruce contra los `map.json` del árbol.

> **MEDICIÓN · 2026-09-21** — al cruzar `workers` contra canon apareció **un choque de nombres que
> habría sido invisible**: canon llama `legacy-application` al monolito original y los alias de acá
> lo llaman `application`. Sin traducirlo, los **215 archivos** que canon declara de ese repo cruzan
> a cero, y el resultado no es un error sino un «ningún tema lo explica» sobre el repo más grande.
> La traducción es una línea en `tools/canon.py` y está documentada ahí. Medido después de arreglarlo:
> canon declara **1.006 archivos en 34 temas**; el índice reconstruido pasó de 1.363 archivos con
> nodo del árbol a **891 con tema de canon** — canon declara menos, y a propósito.

**Las puertas ya no mandan a `context/`.** Reapuntadas las 39 menciones: el `CLAUDE.md` raíz (la
tabla de «qué herramienta según qué preguntás», el CICLO, el bucle de lo que mergea otro, las reglas
de honestidad), `README.md`, `tablero/CLAUDE.md` (incluida la sección «Retomar una tarea», que
describía un ruteo con modelo que ya no existe), `harness/CLAUDE.md`, `trazador/CLAUDE.md`,
`workers/README.md` e `INDAGAR.md`, la plantilla de tarea y el `schema` del tablero.

⚠ **Y una conclusión que no buscaba: Jev se apaga con el árbol.** Su corpus era 100 % los nodos
(`tree.json` + `server/data/flows/*`) y no menciona canon ni una vez; `route` y `brief` se quedan sin
a qué rutear. Lo que hacía ya lo hace canon mejor y gratis: `-pregunta` y `/api/search` devuelven la
sección exacta con los archivos que la sostienen. El Jev que SÍ sigue es otro, `tablero/tools/jev.py`,
que tría tareas y no toca el corpus.

**Lo que queda:** borrar `context/` (34 nodos, 1,2 MB, más `src/`, `dist/` y `node_modules/`), sus 13
comandos `make context-*` y las menciones al «árbol» en la sección de estilos del CLAUDE.md raíz, que
habla de cuatro UIs y van a quedar tres.

### 2026-09-21 · la desconexión, paso 1: las dos herramientas que dependían del árbol

Antes de borrar nada hubo que **sacar de `context/` lo que tenía que sobrevivirlo**. Eran dos, y el
orden importaba: borrar primero y arreglar después dejaba muda a `make trampas`, que es la más usada.

**1 · El motor de citas se mudó al tablero.** `context/tools/refs.py` (500 líneas) validaba las
`archivo:línea` anclando por CONTENIDO —guarda el texto que tenía la línea el día que se afirmó y lo
busca en `main` hoy—, y de ahí lo consumía `make trampas` por subprocess. Hoy vive en
`tablero/tools/citas.py`, autosuficiente: se llevó también la lista de repos, la resolución de la ref
a mirar (la que CONTIENE a la otra) y el índice de «qué existe en main», que estaban repartidos entre
`roots.py` y `oracle.py`. **No quedó ninguna copia:** `roots.py` pasó a ser un puente que re-exporta,
`oracle.py` importa `del_ref` de ahí y `refs.py` quedó en 51 líneas que sólo recorren nodos. La vara
de que el motor es el mismo: las trampas dan **exactamente** el mismo resultado que antes de mover
—149 citas · 121 ancladas · 26 sin ancla · 1 que no existe—, y los cinco tests de `context/tools`
siguen en verde.

> **MEDICIÓN · 2026-09-21** — el chequeo de citas de `make trampas` **no podía ponerse en rojo**.
> Filtraba las líneas del validador que anunciaban movidas o reescritas y guardaba el resultado en
> una variable que no leía nadie: imprimía el resumen y devolvía 0 igual. Probado al revés moviendo
> una cita buena (`pkg/asesor.ts:178` → `:900`): antes salía en pantalla y el comando daba verde;
> ahora sale `✗ … tiene 371 líneas` y `make` devuelve error. Reproducible: `make trampas`.

**2 · `make retomar BRIEF=1` dejó de pedirle la ficha a un modelo.** Hasta hoy la ficha de un nodo la
generaba Jev sobre su `doc.md`: costaba una llamada, tardaba, y podía decir algo que el doc no dijera.
Un tema de canon ya trae el resumen **escrito a mano** —`title`, `summary`, y el `objetivo` de cada
área, que es literalmente «qué contesta esta parte»—, así que ahora la ficha se **deriva** de su
`map.json`. Sale gratis, es instantánea, no puede inventar y funciona sin red y sin nada corriendo.

> **MEDICIÓN · 2026-09-21** — sobre la tarea #4 (`canon: [onboarding, kyc]`): la retoma pesa 1.373 B
> y con `BRIEF=1` 8.428 B, o sea que las dos fichas pesan **7.055 B contra 51.284 B** de los dos
> `context.md` que evitan abrir — **7,3×**. La versión con modelo pesaba 5.074 B por una sola ficha.
> Reproducible: `make retomar N=4 BRIEF=1`.

**3 · El frontmatter dice `canon:`, no `context_nodes:`.** El campo cambió de significado, así que
cambió de nombre: sus valores son temas del corpus compartido. Se migraron las **45 tareas** con un
mapa nodo→tema derivado de los punteros que los propios nodos dejaron al graduar (`corbeta` →
`bancolombia`, `deceval` → `formalizacion`, `servicing` → `cartera`, `merchants` → `altas`…) y, donde
no había puntero, de la búsqueda de canon. La validación de `make tareas` ahora comprueba contra el
corpus y **falla nombrando el campo viejo** si lo encuentra: ignorarlo en silencio habría hecho que
una tarea perdiera sus temas sin que nadie lo notara. ⚠ Si el corpus no está clonado, la validación
se SALTA y lo dice — canon vive en otro repo y bloquear el tablero por eso sería peor.

⚠ **`findings` no tenía tema y no lo tiene:** las trampas del sistema son crónica y canon la rechaza
por regla. Viven en `tablero/data/trampas/` desde hoy, que es de este repo, así que salieron del
frontmatter de las seis tareas que las declaraban.

**Lo que falta para poder borrar el árbol:** las 39 menciones a `context/` en las puertas
(`CLAUDE.md` raíz 18 · `tablero/CLAUDE.md` 11 · README 5 · harness 2 · trazador 3), los 14 comandos
`make context-*`, y recién ahí los 34 nodos.

### 2026-09-21 · el plan: context se apaga por graduación a canon

**PR #266 MERGEADO y VALIDADO CONTRA PROD.** Las 16 reglas están desplegadas y se probaron con dos
preguntas al canon real, elegidas para medir cosas distintas:

- *«¿por qué el backoffice dice que esta entidad no está lista para operar?»* → contestó **bien y
  completo** (los tres chequeos que bloquean), o sea que la sección **es alcanzable**. Pero salió
  `respaldada=false` con cero citas: es el bug conocido del rebote por titular largo, **no** un
  problema de la redacción. Confirmado en vivo.
- *«una fecha se ve cinco horas antes, a veces en el día anterior»* → **`respaldada=true`, con la
  cita exacta**. Era la prueba dura: esa regla la gradué a `datos`, un tema DISTINTO del que la
  originó, y el modelo la encontró igual. **El criterio de «graduar al tema donde alguien la
  buscaría» funciona**, y eso valida cómo vengo repartiendo.

Detector del despliegue, gratis y determinista: `curl -s …/api/index | grep -c '<ancla>'` — pasa de
0 a 1 cuando prod ya lo tiene. Tardó unos diez minutos desde el merge.

**TEMA NUEVO EN CANON: `negocio`** (34 temas, 425 secciones). Miguel corrigió algo que yo había
dicho mal: que el negocio no podía ir a canon porque no se verifica contra `main`. Es falso — el
propio `dictar.md` dice «reglas técnicas, **de negocio** o producto», y su ensayo ofrece «te lo
contaron» como procedencia válida. Lo que hace falta no es código: es **declararla**.

Entraron las dos reglas de más arriba del modelo: que **a la entidad también se le cobra** —lo que
se vende es distribución y un candidato ya consultado, no un dato crudo— y que **el que decide es
el comercio**, que explica la configuración por comercio, la personalización y por qué un comercio
grande caído es el peor incidente aunque el volumen sea chico. Las dos declaran que NO salen del
código.

⚠ Y esto **cambia la tercera categoría** que había escrito hace un rato: el proceso comercial sí
tiene casa en canon. Lo que no la tiene es lo que no se puede sostener con nada —ni código, ni
medición, ni alguien que lo afirme—.

**EL BARRIDO ESTÁ HECHO, y el resultado es que context se puede matar mucho antes de lo que
parecía.** De los 34 nodos:

- **15 revisados.** Seis cedieron reglas (11 en total). **Nueve no cedieron NADA** —`bancolombia`,
  `kyc`, `merchants`, `onboarding`, `profiling`, `servicing`, `credifamilia` y los demás— porque
  canon ya los cubre, y en varios casos **mejor**: generaliza donde acá está el caso puntual
  (los dos listados), o corrige (quién desembolsó lo escriben TRES caminos, no el webhook).
- **8 estructurales** (`application`, `legacy-backend`, `frontend-monorepo`, `microservicios`,
  `architecture`, `form-service`, `creditop`, `ms-preapprovals`): catálogo de repos y endpoints.
  Canon pide reglas, no catálogos.
- **11 con 0-3 secciones propias**: casi puro formato.

⚠ **La conclusión que importa: el trabajo que queda NO es graduar, es BORRAR.** La estimación de
«50-60 reglas más» era alta — lo que falta escribir es poco, y lo que falta es sacar nodos que ya no
aportan. Eso se hace en una sesión, no en diez.

**PR #267: diez reglas, canon en 421 secciones.** La última —que los criterios de garantía y los
medios de pago son de la entidad y no del comercio donde se editan, así que un comercio le pisa la
configuración a los demás— **fue RECHAZADA en el primer intento, y por una razón que vale más que la
regla**: con ese título, la pregunta «desactivé un comercio y los asesores quedaron sin acceso»
dejaba de encontrar su respuesta. Canon mide eso **antes** de dejar escribir y devuelve qué pregunta
se rompería. Prosa nueva compite con todo el corpus; cambiar el título alcanzó.

**PR #267: nueve reglas, canon en 420 secciones** — se sumaron las cuatro capas de error del pagaré
(donde la distinción que más ahorra tiempo es que un rechazo de seguridad y uno de negocio se ven
igual desde afuera) y que el método de firma es configuración con excepción explícita, no default
silencioso.

**PR #267: siete reglas, canon en 418 secciones** (una sola rama y un solo commit, se actualiza con
cada tanda). Se sumaron el efecto de cambiarle el país a una entidad —que la saca del listado de
todos los comercios del país viejo de una vez— y que el canal de la caja **se cierra de noche y por
lotes**, así que «compró pero no figura» dentro de esa ventana es normal.

⚠ **Y `negocio` destapó una TERCERA categoría, además de «gradúa» y «es inventario»: lo que es
proceso comercial y no tiene respaldo en `main`.** A quién se le cobra, cómo se negocia un alta, el
ciclo de la plata. Canon exige verificar contra el código y declarar los archivos que sostienen la
regla — esto no puede, y su casa es Confluence. De ese nodo sólo graduó la parte que sí tenía
código.

**PR #267 abierto: cinco reglas, canon en 416 secciones.** Se sumaron el desembolso —que lo escribe
un disparador de la base porque la tabla se escribe desde dos aplicaciones en más de veinte puntos—
y que **parte de la lógica vive en la base y su código no está en ningún repositorio**, con sus tres
consecuencias: no se revisa en un cambio, no se versiona y no se levanta un ambiente sólo desde el
repo.

**Y la tercera regla del segundo PR salió de pisar una trampa documentada.** `payments` decía «bug
P0: dos `dd()` en Wompi». Al verificarlo aparecieron más, y contarlos falló primero: usé
`git grep '^\s*dd\('` y devolvió **CERO** — `git grep` no entiende `\s`, que es exactamente lo que
el `CLAUDE.md` raíz advierte. El cero se lee como «no hay» y casi lo doy por arreglado. Con POSIX
salieron **48** (15 y 33 en cada monolito), cinco en caminos de integración con entidades. Lo que
gradúa es la regla —un volcado dentro de un `catch` deja inalcanzable el manejo de error, y la
excepción no aparece en los tableros porque nunca se manejó—; el número va con su fecha.

**Segundo PR abierto en rama propia** (`canon/graduar-desde-context-2`, desde `main` ya al día) con
dos reglas más: el ambiente de pruebas donde conviven usuarios reales —con la lista de números
propios que gana por sufijo antes de la validación— y las cuatro etapas del preaprobado, que el
servicio **no** reintenta solo. Canon en **413 secciones**.

**La medida real de lo que falta: 120 SECCIONES PROPIAS en 34 nodos** (sin contar «Qué es»,
«Contenido», «Dónde mirar» y demás formato). No 2.900 términos: esa métrica medía implementación.
Por lo que salió hoy —`backoffice` 4 propias → 6 reglas, `creditopx` 7 → 3, `motai` 7 → 2,
`bancolombia` 2 → **0**— el ratio ronda **una regla cada dos secciones propias**, con mucha
varianza: hay nodos que no ceden nada porque canon ya los cubre mejor.

**`kyc` comparado y NO graduado.** Canon lo cubre con 23 secciones contra 9, y lo único que sería
regla —que el catálogo de centrales varía por ambiente— **no se verificó hoy**: pide consultar dos
ambientes. ⚠ Si es cierto, corrige a canon, que habla de «las doce centrales» como si fueran doce
en todos lados. Queda anotado en el nodo.

**Dieciséis reglas, canon en 411 secciones · el cruce está terminado.** `motai` cedió las dos que
le faltaban: que el recorrido lo decide el backend paso a paso —y que un paso sin fila de
configuración simplemente no existe para esa entidad, que es el default y no un error— y que **el
mismo id no es la misma entidad en otro ambiente**, donde además desde agosto difiere la fórmula que
cotiza. Los ids concretos no se llevaron: son dato vivo.

Los cuatro temas del cruce (`smartpay`, `onboarding`, `bancolombia`, `motai`) están hechos.

**`bancolombia` BORRADO sin graduar una sola regla — y eso es un resultado, no un fracaso.** El
árbol queda en **34 nodos**. Sus 129 «términos sin cubrir» hacían pensar en mucho trabajo y no había
ninguno: canon ya tenía los timeouts sin techo, el certificado, el error que se rompe dentro del
manejador y las dos fuentes de verdad de Corbeta — esta última **mejor**, porque dice la
consecuencia («el cliente llega al mostrador con un código que nadie puede cobrar») y acá sólo
estaba el mecanismo. Lo operativo (hasta dónde llega una prueba) se fue al `CLAUDE.md` del arnés y
las dos preguntas sin verificar las heredó la tarea de Bancolombia; los punteros de `corbeta` y
`actors` ahora apuntan a canon.

⚠ **Corrección a la métrica que veníamos usando:** contar «términos sin cubrir» **sobreestima** el
trabajo. Mide nombres de archivos, métodos y settings —implementación—, no reglas. `bancolombia`
medía 129 y valía cero. Para estimar sirve comparar SECCIONES, no términos.

**Catorce reglas, canon en 409 secciones.** Siguió `onboarding` por el cruce: el límite del
formulario personal —que se cuenta por DOCUMENTO, así que cambiar de teléfono o abrir otra
solicitud no lo reinicia— y los dos defectos vivos del camino feliz, que canon admite porque su
regla dice «incluidos sus errores».

⚠ **Y ahí apareció el error nº1 de citas del árbol, en vivo:** los dos defectos se citaban **sin
decir el repo**. Buscarlos en `legacy-backend` devuelve cero y se lee como «ya se arreglaron»;
viven en `legacy-application`, en la misma línea que decía la cita. Estuve a punto de escribir que
habían desaparecido. Lo que lo destapó fue mirar cuándo se tocó el archivo por última vez: si no
cambió desde agosto, el bug no pudo arreglarse esta semana — entonces el repo era otro.

**Doce reglas, canon en 407 secciones.** El orden lo puso canon, no el árbol: `-peso` dice dónde se
mueve el código y `smartpay` salió primero entre los temas que además tienen nodo acá. Se graduaron
qué se configura del bloqueo (y que la periodicidad **no** se configura, aunque la pantalla la
prometa) y que ahí los dos monolitos **no** se hablan por tablas.

⚠ **Y el ejercicio de priorización dejó una conclusión propia: las señales de canon dicen DÓNDE, no
QUÉ.** `-peso` da áreas calientes, `-faltantes` da 557 archivos sin declarar, y `-hallazgos` —que
parecía la mejor, con 55 nombres decididos por identidad y sin mención— resultó una trampa: pide
documentar **lo que ella misma deriva**, o sea el mapeo id→nombre. Escribirlo sería duplicar una
herramienta con prosa, el mismo error que hace que `hardcodes-entidades` no gradúe. Lo que sirve es
el CRUCE: caliente en canon **y** con material acá. Hoy son `smartpay` (hecho), `onboarding` (137
términos), `bancolombia` (129) y `motai` (96).

**Diez reglas en el PR, canon en 405 secciones.** Se sumaron el mapa de dónde se cae una entidad
del listado —que fue a `listado`, no a `creditopx`— y la excepción del permiso del comercio.

⚠ **Y una que NO se llevó, que es la lección de esta tanda:** el mapa decía «nueve `unset()`» en la
pre-aprobación y hoy hay **más de veinte**. El número envejeció sin que nada avisara. A canon fue la
regla —que ahí se concentra el descarte, y que varios ocurren **antes** de llamar al proveedor, así
que buscar la llamada en los registros no alcanza para saber si se consultó— y el conteo se quedó
afuera a propósito. Un número que envejece sin fecha no gradúa.

**Un PR, un commit: `canon/graduar-desde-context`.** Se aplastaron los cinco commits en uno solo
con todo el detalle en la descripción, y desde ahí cada tema nuevo se enmienda ahí mismo. La rama se
renombró porque el alcance dejó de ser un tema. **Ocho reglas, canon en 403 secciones.**

**`creditopx`: dos piezas graduadas** — el cupo con aprobación manual (con su lección de
idempotencia: decidir con el flag y escribir «si el estado no es éste, ponelo» no es idempotencia,
es pisar cualquier estado que no sea el destino) y el permiso de pre-aprobados, que deja la regla
general de que **«no aplica» y «se rompió» no pueden verse igual**. Y otra vez apareció lo mismo:
tres de sus reglas **ya estaban en canon** —el bloqueo por crédito activo, el ingreso que no decide
el listado, el motor propio del rotativo— y una cuarta apareció al verificar y acá no estaba: la
aprobación manual se evalúa antes que el codeudor.

**`backoffice` GRADUADO Y BORRADO — el ciclo cierra.** El árbol pasó de 37 a **36 nodos**; canon
pasó de 395 a **401 secciones**. Seis piezas en un PR (`canon/backoffice-readiness`, cinco commits,
sin pushear): los cinco chequeos de «listo para operar», el motivo redactado del perfilamiento, el
orden de montaje con su rastro de sólo escritura, la zona horaria de la base, los dos paneles con la
trampa de despliegue, y el pool de Cognito con sus dos límites de intentos.

⚠ **Tres cosas que sólo aparecen al graduar, y que ninguna herramienta habría dicho:**
- **Lo que NO se lleva.** De los 81 términos del nodo quedaron 40 sin cubrir, y son **inventario**
  —rutas del front, nombres de paquetes, endpoints—: canon pide reglas, no catálogos. Borrarlos es
  la decisión, no una pérdida.
- **Lo que ya estaba, y mejor.** El 409 por versión y la regla de los clones no se tocaron. Y el
  dato de que el panel se despliega desde `lab` **ya estaba en el nodo `microservicios`**: estaba
  disperso en context, no sólo duplicado con canon.
- **Lo que estaba MAL.** El nodo afirmaba que no había workflow de dev para esta app; sí lo hay,
  dispara desde `lab`. Verificar contra `main` antes de dictar lo atrapó.

**Queda sin casa** lo que el nodo declaraba como no verificado, y no gradúa porque canon no admite
lo que no está comprobado: qué ve cada rol dentro del panel (el guard es uno solo, no se comprobó si
hay alcance por rol), y si los dos paneles conviven hoy en producción y bajo qué criterio se manda
gente a uno o al otro. Son preguntas, y su lugar es una tarea cuando alguien las tome.

**Antes:** `backoffice` casi vaciado: cuatro piezas graduadas en un solo PR. En la rama
`canon/backoffice-readiness` (desde `main`, tres commits, sin pushear): los cinco chequeos de «listo
para operar», el motivo redactado del perfilamiento, el orden de montaje con su rastro de sólo
escritura, y —la que más vale— **los timestamps de la base están en hora Colombia, no en UTC**, que
salió del docblock de un middleware y es regla de PLATAFORMA: canon tenía la mitad (`bancolombia`
dice que la app declara UTC) y sin la otra mitad esas dos verdades juntas son justo lo que produce
el error de cinco horas. Esa fue a `datos/context`, no a `backoffice`: gradúa al tema donde alguien
la buscaría, no al nodo de donde salió. `-lint` en verde, 398 secciones.

Del nodo quedan «Qué es» y «Contenido» (la arquitectura del panel nuevo y su autenticación), que es
lo que falta para poder borrarlo.

Dos cosas que el dictado rechazó y valen como formato: **no se describe un endpoint por su llamada**
(«GET /…»), sino la operación; y `section` es el **título legible**, que el ancla la deriva canon.

**Primera graduación hecha, de punta a punta.** `LenderReadinessService` ya vive en canon
(`backoffice/context` § «Listo para operar son cinco chequeos, y dos no bloquean a propósito»),
dictado por su API: la pieza pasó el ensayo con `ready: true`, el área nació con su objetivo, sus
tablas y el hash resuelto solo, y `-lint` quedó en verde (33 nodos · 395 secciones). El commit está
en la rama `canon/backoffice-readiness` del repo compartido, sacada de `main`; el push y el PR los
decide Miguel. De este lado el sub-bloque se reemplazó por su puntero, que es lo que significa
graduar.

Lo que enseñó el piloto, y vale para las próximas:
- **`section` es el TÍTULO legible, no el slug.** Mandarlo como slug deja un `## ` feo en el
  documento; el ancla la deriva canon sola. Costó una corrida y un revert.
- **Sin `objetivo` y `se_deduce_leyendo`, el área nace con un eco del título** que compite en la
  búsqueda con los objetivos de verdad. Canon lo avisa al entrar la pieza y hay que reenviarla.
- **Verificar contra `main` antes de dictar no es ceremonia:** apareció que este nodo numeraba mal
  dos de los cinco chequeos.

**La decisión (Miguel):** no mantener dos contextos. `canon` es lo que está en `main` y se comparte
con el equipo; el tablero es lo que está en progreso; `context/` pasa a ser **la sala de espera de
canon** y se apaga a medida que sus nodos graduan. Nada de migración de golpe.

Lo medido antes de decidirlo: **no son una copia**. 37 nodos contra 33 temas, **8 en común**, y en
esos ocho entre el **49 % y el 84 %** de los términos de context no están en canon — graduar es
migrar contenido real, no borrar repetido. Son dos cortes distintos: canon por tema de negocio,
context por pieza del sistema. `findings` (497 KB, 239 hallazgos) **no migra**: canon rechaza la
crónica por regla escrita («no agregues un relato de quién lo descubrió… ni resultados de
experimentos»), y eso es justo lo que lo hace consultable por el equipo.

**Piloto corrido (`backoffice`, el más acotado):** de cuatro piezas candidatas, **dos ya estaban en
canon y mejor escritas** —la regla de los clones por sucursal explica allá el hueco del admin viejo,
que acá no está—. Lo que falta de verdad es `LenderReadinessService`: **no aparece en ningún tema**,
y sus dos tablas de bitácora están en el diccionario sin prosa que diga qué significan. Se verificó
contra `origin/main` (los cinco chequeos, `blocking: false` en política dura y `applicable: false`
en pagos con cobranza externa) y el aporte pasó el ensayo de canon: `ready: true`, sin rechazos.
⚠ Corrección al pasar: en el código el orden es identidad · validación · pagos · **política** ·
**perfiles**; este nodo los numeraba al revés en los dos últimos.

**Dos defectos de canon encontrados corriéndolo en local**, los dos reportados y sin tocar:
`content/.rino` (config de otra herramienta, en el gitignore GLOBAL) hace que canon descarte el
corpus de disco y use el embebido —hoy coinciden, así que no mintió, pero el día que se edite
`content/` en local la ronda no verá los cambios—, y `/api/propose` **entra en panic** con un `node`
inexistente (`server.go:1621` dereferencia la política sin comprobar). ⚠ Y revienta justo cuando el
aporte está BIEN formado: con uno incompleto contesta, porque el panic está dentro de `if listo`.

### 2026-09-21

La viz perdió la consola de Jev y el ruteo en vivo del buscador, y ganó la pregunta que sí se usa:
**«¿el cambio tocó lo que este nodo AFIRMA?»**, dentro del bloque de alineación y sólo en un nodo con
deriva. Corre `tools/diff.py --json` por un endpoint local —git y aritmética, sin modelo ni red— y
ofrece las dos salidas: leer y corregir, o el comando para triar. La viz sigue siendo de sólo
lectura: escribir es una afirmación de una persona.

Al verificarlo en el navegador aparecieron **dos fallos de contraste preexistentes**, los dos del
tipo que el chequeo estático no ve: el contador del encabezado del árbol heredaba la tinta gris del
`region-head` sobre el relleno de su badge (**1,21:1**) y el badge de deriva pintaba el color del
estado sobre ese mismo relleno (**2,29:1**). El segundo llevaba oculto porque sólo se pinta cuando
hay deriva, y ese día no había ninguno. Los dos arreglados con la regla de las píldoras: una
superficie trae su propia tinta, y el que dice su estado con color va de contorno.

**Los nodos `harness` y `trazador` se retiraron del árbol.** El árbol describe CreditOp; cómo se usa
una herramienta de acá vive en su `CLAUDE.md`, al lado del código y commiteado con él. Sus secciones
operativas se movieron **tal cual** (13 KB al del trazador, 10 KB al del arnés) y el dominio a su
casa: la fila rt=0 corregida en `entities` —verificada contra `main`— y el censo de las 14 tablas de
log a `db-routines`. El árbol quedó en 37 nodos, con lint, oracle, refs y check en verde.

⚠ Tres cosas que aparecieron al hacerlo, y que valen más que el retiro: la copia de la tabla de
`response_type` **ya contradecía** a `entities` en rt=0; los **tres** hallazgos que habían graduado a
un nodo de herramienta estaban incompletos (F-108 a medias —su medición nunca llegó a `db-routines`,
se rescató— y F-32/F-36 nunca llegaron, aunque su hecho ya vivía en `smartpay` y `deceval`, adonde
ahora apuntan); y del nodo `harness` había 61 términos, y del de `trazador` 96, que no estaban en el
`CLAUDE.md` de su herramienta.

Antes de eso, las herramientas de este repo dejaron de contar como deriva. `roots.es_local()` lo decide derivándolo
de la ruta —sin lista que mantener— y `alinear.py` las saca del conteo con un estado propio 🔧, con su
razón impresa: esconderlas sería el otro error. Lo que lo justifica, medido: de **24 archivos con
deriva en todo el árbol, 23 eran de herramientas locales y 1 de CreditOp**, y ese único que importaba
quedaba enterrado. El ranking pasó de tres nodos con ruido a ninguno.

⚠ Y al medir qué costaría RETIRAR esos nodos apareció lo que no se puede perder: de sus términos
propios, **61 del nodo `harness` y 96 del de `trazador` no están en el `CLAUDE.md` de su herramienta**
—entre ellos tablas y códigos de dominio (`ocr_logs`, `otp_logs`, `compare_face_logs`,
`user_request_records`, `CATEGORY_RULE_REJECTED`)—. El retiro es correcto pero pide rescatar primero,
y eso es una tarea propia; el inventario ya está hecho. Sí se rescató lo que ya había divergido: la
tabla de inyectabilidad del nodo `harness` duplicaba la de `entities` y diferían en rt=0. Verificado
contra `main`: el simulador que la copia atribuía a rt=0 es del canal ecommerce (su docstring dice que
imita el webhook de un agregador, y está bloqueado en producción), y ya vive documentado en el nodo
`ecommerce`. `entities` quedó con la fila corregida — en rt=0 decide el lender en su propio sitio y
la decisión no vuelve, que no es lo mismo que «nadie».

`context-diff` suma `CITAS=1`: antes del diff cruza los rangos del cambio contra los números de las
citas `archivo:línea` del doc y dice si el cambio tocó lo que el nodo afirma. Es la parte
determinista de clasificar la deriva —la que no necesita modelo—: el diff de `trazador` son 112.358
caracteres y el mapa veinte líneas. Distingue tres casos que costaron un diagnóstico equivocado cada
uno mientras se escribía: el lado viejo del hunk, la inserción pura (no reescribe nada citado) y la
cita escrita después del sello (no comparable). Las tres piezas quedaron puras y con prueba
(`make context-diff-test`), verificadas mutando el código: las cuatro mutaciones caen.

La comparación es **siempre contra `main`**, nunca contra la rama en la que esté parado el clon:
medido el 2026-09-21, tres de los repos estaban en `fix/…`, `qa` y `develop`, y los tres se
compararon igual contra `origin/main`. Lo resuelve la pieza compartida, y el diff va entre dos
commits, así que el working tree tampoco entra. Ahora además se imprime contra qué ref se comparó y
por qué —«el local va 20 detrás»—, que faltaba: un resultado que no dice de qué ref salió no se
puede contrastar con nada.

Y quedó la pieza donde eso se anota: `make context-triar NODE=x VEREDICTO='…'` escribe un campo
`triado` (hasta qué commit se miró, quién lo dijo, con qué veredicto) **sin tocar `verified`**, se
niega si alguna cita cayó dentro del cambio, y `alinear.py` lo descuenta mostrándolo como 👁 «triado,
sin sellar» — un estado propio, no «al día». Hoy sólo se escribe a mano; `source` está listo para
otra procedencia. Lo reversible es el punto: si mañana la fuente resulta mala, se borran los `triado`
y no se perdió nada, porque el sello nunca se movió.

Lo que sigue, si se quiere clasificar el resto: un banco con etiquetas REALES sale del historial
—`git log` de cada `doc.md` dice cuándo se editó el nodo, cruzado con los commits de sus archivos—,
y recién con esa vara se puede medir si un clasificador acierta. ⚠ Y el error es asimétrico: un falso
«sólo refactor» es invisible y permanente, un falso «mirá esto» cuesta una lectura. Los umbrales
tendrían que ser asimétricos, y eso va en código.

`lint.py` suma `L9`: cruza cada `## Índice` de `findings` contra sus anclas `### F-xx`, en los dos
sentidos. Encontró **9 hallazgos de 239 fuera del índice de síntomas** —F-175…F-182 y F-184, los
últimos agregados— que para quien entra por la puerta declarada no existían. Se escribieron sus nueve
filas y el nodo quedó en verde. Probado al revés: quitar una fila, citar un `F-999` inexistente y
agregar un hallazgo sin indexarlo salen ✗ con exit 1. El síntoma lo sigue escribiendo una persona; lo
que la máquina garantiza es que no falte.

`brief` acepta `--text`: la misma ficha sin `kind`, `version` ni `source_sha256`, para una terminal o
una sesión; la consola sigue consumiendo el JSON. Lo consume `make retomar BRIEF=1` del tablero. Y
quedó escrito dónde Jev NO entra: al retomar una tarea que ya declara nodos, `route` sólo agrega un
modo de error; el ahorro es la ficha, y si no contesta, la pregunta va a `workers/`.

### 2026-09-19

Se absorbió `context-arbol-al-dia`. El router Jev quedó optativo y medido; el estado vigente se redujo
a esta tarea canónica y el detalle anterior permanece en Git.

La vista de Context incorporó una consola redimensionable para recorrer el inventario completo sin
salir del mapa. Tablero usa otro corte: su panel inferior agrupa únicamente las ramas medidas de la
tarea enfocada, con tabla principal y selector de sus repos a la derecha. Se puede redimensionar y
cerrar, y el pie mantiene visible cómo recuperarlo. Las tareas recibieron rutas restaurables para
sobrevivir a una recarga.
