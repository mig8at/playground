---
id: 84
title: "Tablero: retomar cualquier tarea en frío, y que el cierre no dependa de acordarse"
clase: proyecto
stage: work
created: "2026-09-14T21:40:00-05:00"
context_nodes: []
jira: []
jira_title: ""
---

## Para qué sirve, en una línea

<!-- era la publicable; un `clase: proyecto` no sale a Jira, así que queda como nota del cuerpo -->
El registro de trabajo del equipo avisa solo cuando una tarea queda sin lo necesario para retomarla.

## Si retomás esto sin contexto, empezá acá

Miguel pidió (14/9) mejoras al tablero para «tener ordenado el día a día y poder retomar cualquier
tarea», y después «dale con todo lo que consideres». **Estado al cierre del 14/9: los seis pasos del
plan están hechos y commiteados**, más tres que salieron en el camino. Lo que hay hoy: `make cierre` +
hook de `Stop` (una vez por sesión) · `make hoy` (agenda: próximo paso, preguntas vencidas, entrega,
dormidas) · `make retomar N=x` · `make bitacora-add` (minutos medidos por el comando) · lint del
frontmatter al escribir (`tareas -lint` + hook de PostToolUse) · «días sin tocar» en la tarjeta,
dormida a los 14 · el pulso ya ve el playground personal (`PULSO_EXTRA`, agente reinstalado) · el PR
de cada rama aunque sea viejo, y la medición de ramas en paralelo y declarando lo que no alcanzó · el
hook `tests-destructivos.py` que frena la suite de legacy-backend sin ruta. No hay que volver a medir
el diagnóstico inicial: está en el Registro. **La limpieza de los `CLAUDE.md` es otra tarea: #85.**

⚠ La tarjeta con el chip de dormida se verificó por API (39/39 con `tocadoEn`, 22 dormidas) y con el
build de Vite, **no en el navegador**: el server que corre en :8787 es el binario viejo de Miguel y no
se reinició. Se ve al próximo `npm run dev`.

**Al 15/9 se sumó el BARRIDO DE ENTREGA:** la medición de ramas mentía —un squash con el mensaje
editado le cambia el patch-id y `git cherry` deja de reconocerlo—, así que ahora hay una segunda señal
(el commit del PR) y cada ✓ dice cómo se supo. La tarjeta muestra «✓ main» sin abrir nada. De las 40
abiertas, **12 están enteras en `main`** y 18 no se pueden medir porque no declaran `ramas:`
(`make tareas-ramas SUGERIR=1` propone patrón: sólo una de las 18 tiene rama de verdad).

**El próximo paso es:** correr una jornada entera con esto puesto y anotar qué molestó (el hook de
`Stop` frenando en el medio del trabajo es el riesgo conocido) antes de tocar nada más.

## Objetivo

Que cualquier tarea abierta se pueda retomar en frío en menos de un minuto, y que lo que hace falta
para eso (retoma, registro, bitácora, ramas) se complete **porque el sistema lo pide**, no porque
alguien se acuerde.

## Dónde se toca

- `tablero/server/cmd/cierre/main.go` — el cierre del día (hecho).
- `.claude/hooks/cierre.py` + `.claude/settings.json` — el hook de `Stop` (hecho).
- `tablero/server/cmd/tareas/main.go` — el parser de `archived` y los avisos de ids/etapas (hecho).
- `tablero/server/internal/store/store.go` — la guarda de ids repetidos (hecho).
- Pendiente: `cmd/tareas` (un `-retomar`), `src/App.vue` (días sin tocar en la tarjeta),
  `verBitacora` (columna del pulso).

## Cómo se ataca

1. ✔ `make cierre` + hook. 2. ✔ conteo de abiertas e ids repetidos. 3. ✔ `make retomar N=x`.
4. ✔ «días sin tocar» en la tarjeta (git; dormida a los 14, ¿archivar? a los 30). 5. ✔ pulso vs
bitácora: el cierre ya muestra los dos y los minutos sin tarea; y el pulso ya ve el playground personal.
6. Migrar a la plantilla sólo las abiertas en `work` tocadas en las últimas 4 semanas — **queda**: son
textos de otras sesiones y `make retomar` ya dice qué le falta a cada una.
Salieron además: lint del frontmatter al escribir · `make hoy` · `make bitacora-add` · el hook de
tests destructivos · el estado de los PRs viejos y la medición en paralelo.

## Lo que se evaluó y NO se eligió

- **Hook de `SessionEnd`** en vez de `Stop`: no puede devolverle nada al modelo, así que avisaría a
  nadie. `Stop` con `decision: block` sí, y el bucle se corta con `stop_hook_active` + una marca por
  sesión y día.
- **Mirar el transcript entero** para saber qué tareas tocó la sesión: la primera corrida real marcó
  tres tareas ajenas, porque sus slugs aparecían como texto en un script. Se mira sólo `tool_use.input`
  y sólo rutas `data/<slug>.md` o nombres de rama.
- **Fallar la carga del store** ante un id repetido: rompía el tablero entero por un archivo. Se
  renumera la más nueva y se persiste, igual que con `id: 0`.

## Lo que está decidido

> **DECISIÓN · 2026-09-14** — las ramas base (`main`, `develop`, `qa`, `staging`) no cuentan como «rama sin dueño»: tocarlas es un merge o una prueba, no trabajo de una tarea.
> **DECISIÓN · 2026-09-14** — las tareas ya terminadas no se migran a la plantilla (regla de Miguel del 20/8); las abiertas en `work` que se mueven, sí.

## Riesgos

> **RIESGO · 2026-09-14** — el hook frena aunque el usuario esté en el medio del trabajo. Se limitó a una vez por sesión y día; si molesta igual, el siguiente paso es que sólo hable cuando la sesión lleve N minutos sin tocar un archivo de tarea.

## Lo que NO entra

Publicar a Jira desde la tarjeta, ni ningún botón que escriba en Jira: decisión previa de Miguel.

## Cómo se comprueba

    make cierre                 # sale 1 si a una tarea tocada hoy le falta algo
    make cierre DIA=2026-09-10  # un día pasado: la retoma se compara contra el último commit anterior
    make tareas | head -3       # tiene que decir 39 abiertas (no 63) y avisar etapas fuera del vocabulario
    cd tablero/server && go test ./cmd/cierre ./internal/store

> **MEDICIÓN · 2026-09-14** — `make tareas-ramas` antes: 1 min 30, 112 ramas, 20 sin PR (13 ya en main), 6 PRs abiertos, 5 tareas truncadas en silencio. Después: 1 min 00, 120 ramas, 2 sin PR (las dos de respaldo, sin PR de verdad), 10 PRs abiertos, 0 truncadas.
> `make tareas-ramas && python3 -c "…contar pr==null en tablero/data/cache/ramas.json"`
> **MEDICIÓN · 2026-09-14** — `make cierre` sobre hoy: 6 tareas tocadas, 19 piezas faltantes, 3 ramas sin dueño, 60′ de bitácora sin tarea. Sobre el 10/9: 4 tocadas, 10 piezas, 151′ sin tarea.
> `make cierre DIA=2026-09-10`

## Registro

### 2026-09-15

**Cómo está repartido un archivo de tarea, medido.** Miguel preguntó si hay forma de ordenar o dividir
mejor. La medición sobre las 40 abiertas: **la mediana pesa 16 KB y está sana**; el problema son 11 que
pasan de 40 KB y 6 de 80. Y la causa NO es la que uno supone: las grandes no crecieron por el Registro
—que es append-only a propósito y que `make retomar` ni siquiera muestra entero— sino porque **el
ESTADO se volvió un diario**. `lenders` es 90% estado con 21 secciones fechadas de 72; `bancolombia`,
100% estado. En total, 91 de las 621 secciones de estado llevan fecha.

De ahí que las clases de contenido pasen de dos a **cinco**: ESTADO y PLAN se reescriben, **MATERIAL**
(recetas, consultas, datos de prueba) se MANTIENE —era la que no tenía nombre, y por eso crecía como
secciones nuevas arriba—, REGISTRO se apila, y CONOCIMIENTO gradúa a `context/`. ⚠ Tener fecha no
condena una sección: «Cómo se prueba, de cero (verificado el 20/8)» es material vigente. El test que
discrimina es el de siempre: si esto se mergea mañana, ¿sigue siendo cierto?

`make anatomia` lo mide y NO mueve nada: señala. Y a propósito el lint no avisa por tamaño — corre en
cada escritura y tiene que hablar de lo que está mal, no de lo que está grande; un archivo de 80 KB
puede ser correcto, y que convenga partirlo es un juicio.

**Proyecto ≠ tarea, y el guard aprendió el vocabulario de las herramientas.** Miguel señaló que en
`data/` conviven dos cosas distintas —el trabajo del día a día sobre CreditOp, y lo propio: las
herramientas, el corpus, el SDK, las mejoras a futuro— y que al compartir a Jira no deberían filtrarse
sus herramientas, aunque sí lo que se hizo contra los datos. **Lo medido antes de tocar nada, que
cambió la conclusión:** de 32 publicables, las 7 que parecían nombrar herramientas eran **falsos
positivos** (el «panel» es el de administración del producto, la «suite» es la de PHPUnit del repo,
las «plantillas» son las del contrato), y 15 ya hablaban de migraciones o consultas. O sea: el riesgo
de filtración casi no se estaba dando —el guard ya frenaba `harness` y `playground`—, y el problema
real era el otro: **23 de 40 abiertas sin clave de Jira**, tratadas igual que las que sí la tienen.

De ahí: `clase: tarea|proyecto` declarada (no deducida — hay trabajo sobre herramientas que SÍ se
publicó, CORE-421), `make hoy` que las separa, la tarjeta que las marca, y el lint que AVISA si un
proyecto conserva publicable. En el guard entraron sólo patrones específicos (`make <target>`,
`E2E_TARGET`, los nombres propios de las herramientas, `localhost`), con el reemplazo escrito en el
motivo; `canon` quedó afuera a propósito porque en renting es el pago mensual. Y la publicable ganó
«Cambios en datos», que es lo que Miguel dijo que SÍ debe compartirse y no tenía lugar.

⚠ **Una lección de método:** el primer test del guard dio «fallos: 0» sin haber corrido — el programa
no compilaba (`internal/` no se importa desde afuera) y el bucle iteró sobre una lista vacía. Es la
misma trampa de siempre: una prueba que no corre se lee igual que una que pasa. Y escribir Go desde un
heredoc de Python convirtió los `\b` de los regex en el carácter backspace, así que los patrones nuevos
no matcheaban nada y el test lo destapó.

**Y el cierre confundía clasificar con trabajar.** Marcar las ocho tareas como proyecto es una línea de
frontmatter cada una, y disparó el reclamo completo —estado, Registro, bitácora— sobre cinco de ellas.
Ahora compara el CUERPO de hoy contra el del último commit anterior al día: si sólo cambió el
frontmatter, no hay nada que cerrar. Es el mismo criterio que ya gobierna el archivo (el cuerpo es el
trabajo; el frontmatter es metadato), y el aviso pasó de cinco tareas a ninguna.

**El hook reclamaba tareas que esta sesión sólo había LEÍDO.** Frenó pidiendo registro y bitácora para
`sdk-del-comercio`, que no tocó nadie acá: estaba sucia por OTRA sesión sobre el mismo worktree, y el
hook la dio por propia porque el día anterior hubo un `head` sobre ese archivo. Dos intentos hasta que
quedó bien: exigir «la ruta aparece Y el comando escribe algo» seguía marcándola —casi todo comando
escribe algo, y ese mencionaba la ruta dentro de un `echo`—, así que la señal pasó a ser la
**adyacencia**: la ruta pegada al verbo (`>`, `tee`, `sed -i`, `git add`, `open(…,'w')`), o el modo
`p='…'` + `open(p,'w')`, o un `file_path` de Write/Edit. Verificado con 12 comandos (5 que leen, 7 que
escriben) y contra el transcript real de esta sesión: antes reclamaba dos tareas, ahora una, la única
que se escribió. ⚠ Y hay un borde que costó los dos intentos: el comando viaja DENTRO de un JSON, así
que antes del verbo puede haber una comilla y no un espacio — exigir `\s` dejaba pasar `git add` y
`sed -i` sin detectarlos.

**Barrido de entrega: cuáles tareas están en `main`.** Miguel pidió que el ✓ de `main` apareciera
cuando la tarea esté mergeada. Ya existía la columna, pero mentía en dos casos y no cubría a la mitad
de las tareas. Lo medido y lo hecho:

- **El patch-id no alcanza.** `frontend-monorepo#983` se mergeó con squash y mensaje editado → patch
  distinto → `git cherry` lo daba por no llegado, teniéndolo en `main` desde el 14/9. Segunda señal: el
  commit del PR como ancestro del ambiente. Cada ✓ guarda su procedencia (`patch` | `pr`) y la tabla los
  distingue. Test con un repo temporal que reproduce el squash.
- **Medir una tarea borraba las demás.** `ramas -n 62` dejaba el snapshot con esa sola; nada avisaba.
  Ahora fusiona, y cada tarea lleva su fecha.
- **18 de 40 tareas no declaran `ramas:`** y por eso no se miden. `SUGERIR=1` rankea ramas por lo que
  comparten de raro; con las claves de Jira del cuerpo daba falsos positivos (le adjudicaba a Motai las
  ramas de CORE-258 y CORE-431), así que salen del frontmatter. Resultado: **una sola** de las 18 tiene
  rama de verdad (la 62), ya declarada y medida — las otras 17 todavía no tienen código.
- **UI:** el resumen de entrega en el botón de la tarjeta (verde/ámbar/gris), columna `main` destacada,
  fecha por tarea, y la URL de la API por variable para poder levantar una segunda instancia sin tumbar
  el `npm run dev` de nadie.
- **Lo que el barrido destapó:** Alta Fleet (#76) está en `main` desde el 14/9 y su tarea decía lo
  contrario; se borraron sus dos marcas `⏳ PENDIENTE DE MERGE` y el `pending_merge` del `map.json`,
  verificando antes archivo por archivo.

### 2026-09-14

**Tercera tanda — «dale con todo».** Lint del frontmatter al escribir (`tareas -lint` + hook; baseline
0 problemas en 65 archivos tras normalizar 3 etapas y un nodo). `make bitacora-add` con minutos de UNA
fuente declarada (lapso · pulso · N con fuente); se colgó leyendo stdin y ahora la nota por stdin es
explícita. `make hoy` y `make retomar`. `tocadoEn` en el store con dos llamadas a git y el chip de
dormida. El pulso no veía el playground personal (su raíz es `github/`): `PULSO_EXTRA` con nombre
explícito porque «playground» choca con `github/playground`; agente reinstalado y sembrado. El hook
`tests-destructivos.py`: la primera versión frenó mi propio commit por NOMBRAR «make test» en el
mensaje → mira sólo la posición de comando por segmento y salta heredocs; 21 casos. Tarea #85 con el
inventario de las 10 correcciones inline de los `CLAUDE.md`. Descartados: `SessionEnd`, un
`CHANGELOG.md` para las correcciones, reescribir los `CLAUDE.md` sin Miguel.

**Segunda tanda — el estado de los PRs.** Miguel preguntó por «sacarle el jugo a git» para saber si un
PR está abierto o mergeado y si ya está en `main`. Ya existía (`make tareas-ramas`), pero con dos
huecos medidos: (1) la lista de `gh` trae los **200 PRs más nuevos** y todo lo anterior salía «sin PR»
—20 de 112 ramas, y una con un PR **abierto contra `main`** invisible, `legacy-backend#1043`—; (2) la
corrida entera tardaba 1 min 30, justo el timeout de 90 s, y al vencerse **cinco tareas salían con cero
ramas sin ningún aviso**. Arreglos: búsqueda por rama sólo para los huecos (filtrando por nombre
exacto, porque `head:x` también trae `x-onto-develop`), tareas en paralelo de a cuatro con caché de PRs
con candado, `-timeout` configurable (5 min) y el snapshot declara `incompletas` y la tarjeta lo muestra.

Diagnóstico medido sobre las 39 abiertas (arriba). Hecho: `make cierre` con `-dia/-json/-quiet`,
hook de `Stop` una vez por sesión, arreglo del conteo de `make tareas` (leía `archived` como
booleano y son fechas), guarda de ids repetidos en el store con test, y la tarea de Confluence
pasó del 79 al 83 porque colisionaba con una archivada. Descartados: `SessionEnd`, mirar el
transcript entero, fallar el store. Todo verificado corriéndolo contra hoy y contra el 10/9.
