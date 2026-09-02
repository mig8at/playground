---
id: 72
title: "Canon: las mejoras del bucle de agentes, validadas y con plan"
stage: work
created: "2026-09-01T15:30:00-05:00"
context_nodes: []
jira: []
ramas: agentes/poda-de-la-maquinaria-2, agentes/un-archivo-malo-no-tira-la-entrega
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Canon (`Creditop-SAS/playground`, `tools/canon`, `canon.playground.creditop.com`) tiene un bucle de
cinco labores que mantiene el corpus al día con `main`: triaje → planificador → redactor → integrador
→ verificador. **Al 2026-09-01 las cinco existen y corren desde la pantalla `agentes`**, manual y con
la forma de GitHub Actions (barra de orden, lista en filas, costado, página por tarea). El PR con todo
eso es `Creditop-SAS/playground#48`, en verde, sin mergear.

Esta tarea es **el backlog validado** de lo que le falta. Cada ítem tiene la evidencia que lo
justifica —medida, no supuesta— y cómo se ataca. Lo que ya se hizo NO está acá: está en el PR.

⚠ **Local no reemplaza a prod para medir.** Gemini 3.7 nunca produjo un `declarar` en cuatro vueltas
locales; Sonnet en prod lo produjo en 4 de 7 afirmaciones. Todo lo que dependa del comportamiento del
modelo se mide después de mergear, no antes.

**Al cierre del 2026-09-01, ocho de los nueve ítems están CONSTRUIDOS y probados en local, dentro de
#48** (1, 2, 3, 4, 5, 7, 8, 9). Queda el 6 —el costo— porque su primer paso es medir en prod.

**#48 está mergeado y la primera vuelta en prod está ABIERTA** (17 tareas, 1 revisada). Los números
medidos están en el Registro de la noche del 2026-09-01; dos hallazgos van en #49.

**El próximo paso es:** que Miguel mergee **#59** (la entrega no se cae por una ruta mala) y **#62** (la poda,
paso 1, contra `main`; en cualquier orden, simulado sin conflictos) y arrancar el **paso 2: enlazar
sección→área en el mapa** — de ahí salen gratis la poda de prosa, el
respaldo de cada afirmación y qué archivos abrir para una pregunta. Antes de tocar el redactor o sus
puertas, `python3 tools/canon/dev/humo.py`: el circuito entero con los falsos, sin gastar un token.

⚠ La evaluación del 2026-09-02 (medida, sin modelo) dice: el corpus SÍ es lo que Miguel describe y
NO está creciendo de más (+6% en 5 días, 23,9k palabras para 557 archivos); lo que crece es la
herramienta (README = 66% del corpus, tres redactores, un camino de escritura muerto). El mapa sólo
puede crecer o quedarse quieto: **no hay `retirar`**, y la prosa no apunta a las áreas. Y hay un comando
roto por mí: `canon -expediente <tema> <carpeta>` quedó tapado desde `5caf79a`. Lo que sigue abierto
de antes: **21 preguntas reales de soporte sin cobertura** (banco: 92/115 al primer resultado) — eso se
arregla escribiendo, no vigilando.

## Objetivo

Que una vuelta del bucle en prod termine en un PR revisable **sin que nadie tenga que corregir a mano
ni el estado de la pantalla ni el plan**, y que lo que cuesta se sepa antes de apretar.

## Dónde se toca

Todo en `Creditop-SAS/playground`:

- `tools/canon/internal/api/tareas.go` — el plan (`plan.tareas`, en memoria), `tarjetasDePlan`, `consolidar`
- `tools/canon/internal/api/corridas.go:155` — `const tope = 20`
- `tools/canon/internal/api/tareas.go` ~766 — el esquema del planificador, `archivos` sin formato
- `tools/canon/internal/modelo/modelo.go:212` — el techo de 120k por corrida
- `tools/canon/Dockerfile:15` — `go test ./...` sin `-race`
- `tools/canon/src/bucle.js` — `enCola`, `vuelta`, `escuchar`
- `tools/canon/src/componentes/Corrida.vue` — `proponer`
- `tools/canon/skills/vigilar.md` — 899 de 900 palabras

## Cómo se ataca

Ordenado por lo que más cambia el resultado por unidad de trabajo. Cada punto se entrega solo.

### 1 · Persistir el plan: hoy un deploy resetea la vuelta — ✅ EN #48

**Evidencia.** Cada reinicio del servidor local hoy volvió la pantalla a las tarjetas gruesas del triaje
(pasó cinco veces en la sesión). El guion ya lo anota como deuda. Con el flujo «acumular → analizar →
correr una por una → consolidar», un deploy a mitad de vuelta tira la vuelta.

**Cómo.** El plan es estado de trabajo, no corpus: no va al corpus ni a `main`. Va a **la rama del
bucle** (`canon/contexto`), como `tools/canon/.vuelta.json`, escrito con el mismo cliente de GitHub que
ya usa el borrador. Vive donde viven los productos de la vuelta y muere con el merge del PR, que es
exactamente el ciclo de vida que tiene. Al arrancar, si hay rama, se lee. Sin `CANON_PUBLICAR` (local)
se guarda en disco al lado del corpus.
**Por qué no la alternativa:** reconstruirlo desde las corridas no sirve porque las corridas también
viven en memoria (ítem 3).
**Cómo quedó.** `SumarALaRama` ganó un `abrirPR bool`: guardar el plan commitea en la rama SIN abrir PR
(analizar no debe hacer aparecer el chip). Medido contra el GitHub falso: analizar crea la rama,
`/api/pr` sigue en `abierto: false`, y reiniciar recupera «de la rama canon/contexto».

### 2 · La cola de cambios nuevos se calcula con lo que escribió el modelo — ✅ EN #48

**Evidencia.** `enCola` compara los archivos de la ronda contra `t.fuentes`, que son los `archivos`
que el planificador escribió en texto libre — y **el esquema no le pide formato** (línea ~766: `array
of string`, sin `description`). A veces escribe `repo:ruta`, a veces sólo la ruta. La pantalla mostró
«7 en cola» de 15: plausible, pero no confiable.

**Cómo.** Cobertura del lado del servidor y determinista: cada tarea del plan tiene `Area`, y el área
tiene sus `fuentes` conocidas. `/api/tareas` devuelve `cubiertos` (repo:ruta) y el frente compara
contra eso. El texto libre del planificador deja de decidir nada.
**Trampa que salió construyéndolo.** El número de área es el del MAPA del tema (`nodo.Areas[n]`), no
la posición en el residuo — el residuo trae sólo las áreas que cambiaron. El primer intento indexaba el
residuo y daba `cubiertos: 0` para una tarea que cubría un archivo. Se resuelve por OBJETIVO.

### 3 · El tope de 20 corridas evicta las de la vuelta en curso — ✅ EN #48

**Evidencia.** `const tope = 20` en `corridas.go:155`. Una vuelta de 4 tareas + reintentos +
consolidación + `proponer` son ~10 corridas; dos vueltas y una tarea del plan deja de encontrar la
suya, y la tarjeta vuelve a `lista` con el ▶ como si nunca hubiera corrido.

**Cómo.** No evictar las corridas que el plan referencia. Cinco líneas en `abrir`. Cuando el plan se
persista (ítem 1), persistir con él sus corridas cerradas.

### 4 · CI no corre el detector de carreras — ✅ EN #48

**Evidencia.** `Dockerfile:15` corre `go vet ./... && go test ./...` — sin `-race`. Hoy se arreglaron
cuatro carreras de datos reales (verificadas con `-race`: el patrón viejo las marca). Si vuelven, CI
no las ve.

**Cómo.** `-race` necesita cgo, y `golang:1.23-alpine` no trae gcc. Dos opciones: `apk add gcc
musl-dev` en la etapa de compilación (+40 s de build), o un paso `go test -race ./...` en el workflow
`revisar` con `setup-go`, fuera de Docker. **La segunda**: no engorda la imagen y corre en paralelo.

### 5 · `no alcanza` casi siempre es «el archivo no está declarado», disfrazado — ✅ EN #48 (falta medir si Sonnet lo llena)

**Evidencia.** En prod, `no alcanza` fue el veredicto dominante y `declarar` el siguiente (4 de 7).
Leyendo los detalles, buena parte de los `no alcanza` dicen «la lógica está en X y X no está en el
área» — o sea, un `declarar` que el redactor no supo nombrar como tal.

**Cómo.** Que `no alcanza` pueda llevar `archivos` (qué le habría hecho falta), igual que `declarar`.
El aplicador mecánico ya existe: con un click una persona declara lo que el agente pidió, y la
próxima vuelta ese redactor concluye en vez de rendirse. Cambio de esquema + botón en la página de la
tarea. **Medir en prod** cuántos `no alcanza` traen archivos.

### 6 · El costo de una vuelta con Sonnet, y el techo de 120k — 🔁 REDISEÑADO EN #54: el redactor por tema con el expediente empujado (79k la vuelta); falta confirmar en prod

**Evidencia.** En prod, 3 de 4 redactores llegaron al techo de 120k tokens. La ley de costo está
medida: el contenido del prompt se paga una vez; cada turno reenvía el historial entero, así que el
costo crece con el cuadrado de los turnos. Las instrucciones de presupuesto NO aterrizan en Sonnet
(las de formato sí): el tope de 6 búsquedas tuvo que ir en código.

**Cómo.** Primero medir una vuelta entera en prod con la pantalla nueva (el costado ya suma tokens).
Después, en orden: (a) `leer` devuelve la SECCIÓN y no el tema entero salvo pedido explícito — hoy el
redactor lee ~9.000 palabras para contestar sobre una; (b) recortar la salida de `codigo` a las
funciones que nombra la afirmación; (c) bajar el tope de turnos del redactor de 16 a 10 y medir
cuántos concluyen igual. Cada uno se mide en prod por separado, porque local no muestra el costo.

### 7 · Ids estables entre reanálisis — ✅ EN #48

**Evidencia.** Los ids son posicionales (`p1`, `p2`). La guarda de la firma evita que un veredicto se
pegue a otra pregunta, pero `/agentes/p1` sigue apuntando a otra cosa después de reanalizar: el enlace
que alguien pegó en Slack cambia de significado.

**Cómo.** `id` = hash corto de `tema + primera afirmación`. Con eso la guarda de la firma se vuelve
redundante (misma pregunta ⇒ mismo id) y los enlaces sobreviven. Tocar `tarjetasDePlan` y el frente.

### 8 · Tres pequeñas, de una tarde — ✅ EN #48

- **`/api/estado` pesa** (5 lecturas a GitHub) y se pide en cada entrada a `agentes`. Cachear 2 min,
  como `/api/pr`.
- **El chip del PR tarda hasta 2 min en aparecer** tras el primer `proponer`: `refrescar` llama a
  `/api/pr` y está cacheado. Al terminar `proponer`, pedir `/api/pr?forzar=1`.
- **El caño en vivo refresca tres endpoints por cada paso** de cada agente. Debounce de 500 ms en
  `escuchar`.

### 9 · `vigilar.md` está en el techo — ✅ EN #48

**Evidencia.** 899 de 900 palabras; cada cambio de esta sesión obligó a podar otra cosa para entrar.

**Cómo.** Partirlo: «el bucle» (labores, veredictos, límites) y «el arnés» (los endpoints de
`/api/corridas`, que hoy ocupan un tercio). El lint del techo existe para que un skill sea una
instrucción; dos instrucciones cortas son mejores que una al límite.

## Lo que se evaluó y NO se eligió

**Disparo automático (reloj o merge).** Se construyó un despertador con hora de Bogotá, se probó en
local y **se sacó** el mismo día por pedido de Miguel: la vuelta la manda una persona, y un PR que nadie
pidió, escrito mientras nadie miraba, es lo que uno termina mergeando sin leer. Se reconsidera cuando
se sepa qué cuesta una vuelta en prod (ítem 6). Y NO como workflow de Actions: habría que pasarle a
Actions la llave de escritura de canon para llamar a una instancia que ya la tiene.

**Reanalizar como acción principal.** Rehace el plan desde cero y deja huérfanas las conclusiones
pagadas. Hoy es secundario y pide confirmación; lo que entra después se encola (ítem 2 lo hace
confiable).

**Un segundo camino de escritura.** `POST /api/propose` con `apply` escribía sin la compuerta del
banco de preguntas. Cerrado (410); el ensayo se conserva. No se reabre.

**Mostrar las corridas huérfanas y la doctrina en la pantalla.** Sacadas por ruido: la doctrina vive
en el guion enlazado; las corridas siguen en `/api/corridas`.

## Lo que está decidido

> **DECISIÓN · 2026-09-01 (noche)** — **el cambio va solo al PR cuando el redactor concluye seguro** (`ya no` / `declarar`). La certeza es el veredicto, no un puntaje. La compuerta es el PR, que aprueba una persona. La consolidación deja de ser un paso (queda como dictamen opcional por API). Pedido de Miguel tras la primera vuelta en prod; construido en #51.
> **DECISIÓN · 2026-09-01** — la vuelta la manda una persona desde `agentes` (analizar y correr); lo que corre solo es la ESCRITURA de lo que concluyó seguro, nunca el disparo.
> **DECISIÓN · 2026-09-01** — el costado va a la IZQUIERDA, como en Actions; el orden del DOM deja la lista primero.
> **DECISIÓN · 2026-09-01** — la consolidación aparece sólo si la vuelta terminó Y propuso algo. `no alcanza` no bloquea.
> **DECISIÓN · 2026-09-01** — un solo camino de escritura al corpus: el borrador. `propose` sólo ensaya.

## Lo que está bloqueado

> **PREGUNTA · 2026-09-01 · Miguel** — ¿mergeamos #48 antes de seguir? Todo lo que sigue se mide en prod.

## Riesgos

> **RIESGO · 2026-09-01** — el frente no tiene tests: toda la verificación de hoy fue en el navegador. Cada cambio de `bucle.js` se comprueba a mano.
> **RIESGO · 2026-09-01** — el corpus local de pruebas quedó dos veces modificado por ensayos (`## X / prueba`). Antes de commitear, siempre `git status tools/canon/content/`.

## Lo que NO entra

- Consolidador que **corrija** lo que escribieron otros: sería un sexto integrador. El verificador dictamina.
- Persistir las corridas en el repo: engordan con cada intento. Sólo el plan y sus corridas cerradas (ítem 1).
- Cambiar de modelo local: 3.7 sirve para bugs estructurales; el costo y los `declarar` se miden en prod.

## Cómo se comprueba

Local, con el GitHub falso (`/tmp/canon -github-falso 8599 ~/Desktop/CREDITOP/github`) y la instancia
con `CANON_GITHUB_API=http://127.0.0.1:8599 CANON_PUBLICAR=1`:

```
curl -s -X POST :8080/api/tareas/agrupar -H 'x-canon-key: local'        # analizar
curl -s -X POST :8080/api/tareas/p1 -H 'x-canon-key: local'             # correr una
curl -s -X POST :8080/api/tareas/p1/proponer -H 'x-canon-key: local'    # proponer
curl -s -X POST :8080/api/tareas/consolidar -H 'x-canon-key: local'     # verificar la vuelta
curl -s :8080/api/pr | jq                                               # el PR abierto
```

> **MEDICIÓN · 2026-09-01** — vuelta local completa: 4 tareas revisadas en 80 s; `proponer` reescribió 2 secciones por 6.086 tokens; el verificador dictaminó `puede ir` en 46 s.
> **MEDICIÓN · 2026-09-01** — prod (Sonnet), última vuelta antes de #48: 7 afirmaciones, 4 `declarar`, 0 `ya no`, 3 de 4 redactores al techo de 120k.

Los portones, siempre: `go test -race ./...` · `canon -lint` · `-bench` · `-soporte`.

## Registro

### 2026-09-02 · mañana · 14 — paso 1, la PODA: un solo redactor y fuera lo que nadie usaba (#61)

Miguel: «vamos paso a paso mejorándolo y simplificando en lo posible el código si ves que es muy grande y
hay cosas que ya no se van a usar». Se empezó por podar porque es lo de menor riesgo y deja menos código
por el que enhebrar después el enlace sección→área.

**Lo hecho** (`Creditop-SAS/playground#61`, rama `agentes/poda-de-la-maquinaria`, base #60):
- **Un solo redactor.** Las tres puertas (`/api/tareas/{id}`, `/{tema}`, `/tema/{tema}`) convergen en
  `revisarTema` vía `correrRedactor`; `revisar`, `guionRedactor`, `herramientaCambios` e
  `herramientaHistoria` se fueron. Un tema sin tareas en el plan se reparte con `planDeterminista` y se
  suma al plan.
- Fuera `/api/relations`, `/api/policy/`, `-deriva` y 5 símbolos muertos (`golangci-lint --enable unused`,
  que ya estaba instalado y nadie corría). **`/api/yo` se queda: es contrato del repo** (`dev/conformidad.js`,
  CLAUDE.md del playground compartido) — por poco lo borro; la verificación externa lo salvó.
- **`-expediente <tema> <carpeta>` destapado** (regresión mía de `5caf79a`); el que pesa es `-pesar`.
- `-faltantes` falla a la vista con la raíz mal · `CANON_SIN_VUELTA` tampoco guarda · la constancia de
  arranque de cada tarea va ANTES de armar el expediente · si el redactor se cae, cada tarea queda caída.
- El impostor (`-modelo-falso`) **no veía el enunciado**: con caché de prompt el adaptador lo manda como
  bloques y el impostor sólo leía strings → sin pregunta no veía las tareas → `concluir` sin `tarea` →
  rechazo → 3 turnos → «no pudo concluir». Arreglado, y ahora contesta un hallazgo por tarea.
- **`tools/canon/dev/humo.py`**: la prueba de humo del circuito con los falsos. Tres corridas hasta el
  «todo bien»; las dos primeras encontraron lo de arriba.

> **MEDICIÓN · 2026-09-02** — **−580 +237 líneas de Go; `tareas.go` de 1473 a 1130**. Tests `-race` 0
> fallos, `unused` 0, gates iguales (lint ✓ · bench 92/115 · soporte 117/118, 21 sin cobertura).
> **MEDICIÓN · 2026-09-02** — humo.py: analizar → 19 tareas; una tarea → 1 veredicto con `afirma` bajo su
> agente; tema de 2 → 2 de 2; doble click → 409; tema a secas → mismo camino; servidor fresco sin plan →
> reparte 2 solas con su corrida; `content/` limpio. 0 tokens.

**Lección para el paso 2:** verificar «nadie lo usa» FUERA de la herramienta (otros repos, CI, contratos
del monorepo) antes de borrar — `/api/yo` parecía muerto desde adentro de canon.

> **DECISIÓN · 2026-09-02** — **Ningún PR se apila sobre la rama de otro PR.** #61 tenía base = rama de #60;
> Miguel mergeó #60 y después #61, y GitHub NO re-apuntó #61 a `main` (sólo lo hace si la rama base se
> BORRA): la poda quedó mergeada dentro de `agentes/el-bucle-puede-terminar`, sin push a `main` y sin
> deploy. Se re-abrió como **#62** (mismo commit, cherry-pick sobre `main`). Desde ahora, base = `main`
> siempre, aunque el diff arrastre el PR anterior hasta que mergee.

### 2026-09-02 · mañana · 13 — evaluación a fondo ANTES de código: ¿el corpus es lo que Miguel dice, y puede crecer y podarse?

Pregunta de Miguel: el corpus como árbol de archivos conectados por flujos de negocio, prosa para lo
que el código no dice, concreto y simple, barato. ¿Es eso lo que hay? ¿Qué se usa y qué no? ¿Qué falta
para que crezca y se pode? Todo lo de abajo se midió **sin modelo**.

**El corpus.**
- 15 temas (13 con código; `vocabulario` e `internacionalizacion` sin áreas) · **85 áreas · 557
  archivos · 182 secciones · 23.933 palabras** (máx. motai 2.653; secciones de 50–300). Las 85 áreas
  tienen objetivo (~20 palabras) y `se_deduce_leyendo` (~22). bancolombia+listado = 295 archivos (53%).
- Nació el 8/26 como **49 documentos por TIPO** (`flows.*` `map.*` `pitfalls.*`, 30,5k palabras), se
  recortó el 8/28 a 14 temas por ASUNTO (22,6k) y hoy son 15 (23,9k): **+6% en 5 días**. No hay
  documentos inmensos; la textura de una sección es «qué significa», no «qué hace el código».
- Ruteo: bench **92/115 al primer resultado · 115/115 top-3 · 115/115 ≤2 pasos**. Soporte: 117/118
  cubiertas se encuentran; **21 sin cobertura** — aval, FGA+IVA, cuota inicial, costos administrativos,
  pago mínimo vs saldo, core bancario, asignación de asesor, reinicio de intentos, reportes.
- Grafo: `related` (listado es el hub, 9 salidas; motai e internacionalizacion, 0), `[[tema]]` en la
  prosa, diccionario de 558 nombres → tema. **Los temas son asuntos, no flujos**: un flujo cruza temas.
- **Secciones y áreas son dos descomposiciones paralelas SIN enlace**: cero `n=` en la prosa, `Section`
  no tiene área. El verificador comprueba «cada afirmación tiene archivo» a juicio, cada vez.
- `verificado_contra` sólo lo escribe el scaffold («pendiente») y lo preserva el borrador; ninguna
  operación lo actualiza. Los 13 dicen 8/27–28.

**La maquinaria.**
- **14,6k LOC Go + 2k front; 853 LOC de tests.** README **15.921 palabras = 66% del corpus**; skills
  3.750; 2.589 líneas de comentario. 23 endpoints: 14 los usa el front, 5 el agente de chat
  (code/read/search/pregunta/skills), `draft` (dictado, vivo: PR #17), `propose` (410) y **4 que sólo
  nombra el README** (policy, tools, yo, relations). 18 modos de CLI (`-deriva` es alias).
- **Tres redactores conviven**: `revisarTema` (correr-todas: UNA llamada, material empujado, 5–20k por
  tema) · `revisar` con foco (`POST /api/tareas/{id}` ← el botón «▶ correr esta tarea» de Corrida.vue:
  tanteo, medido 150k con aterrizaje forzoso) · `revisar` sin foco (`POST /api/tareas/{tema}`, la
  variante de 330k). Dos de tres son la generación cara, y una está a un clic.
- **Crecer**: `declarar` (reactivo: sólo cuando una prosa se queda sin respaldo; 2 commits del bot),
  `-faltantes <raíz>` (por dependencia medida: **442 archivos que los declarados importan y nadie
  declara**; los 20 primeros son modelos y repositorios —`UserRequestRepositoryInterface` en 8 temas,
  `UserFieldValue` en 6—: la FORMA de los datos, que el corpus no describe), dictado, y edición a mano
  (**39 de 49 commits sobre content/ desde el 1/8 son de Miguel; 8 del bot**).
- **Podar**: la ronda detecta `no está en main` y bloquea el tema si están todos; `archivosQueNoExisten`
  impide declarar rutas muertas. **No hay `retirar`**, y sin enlace sección↔área nadie sabe qué prosa
  pierde el piso. Tampoco se mide «secciones que nadie pregunta»: el banco mide pregunta→sección.
- ⚠ **`canon -expediente <tema> <carpeta>` ya no arma el expediente**: desde `5caf79a` (1/9, mío) el
  `-expediente` que PESA lo tapa, y `upkeep.Dossier` —el ÚNICO camino con «candidatos a SUMAR»
  (archivos de los mismos PRs, por carpeta; medido 8/27: 9 de 75 plausibles) y «candidato a QUITAR»—
  quedó inalcanzable. README:692/:763 y las skills `contextualizar`/`recontextualizar` documentan un
  comando que hoy hace otra cosa.
- ⚠ `-faltantes` con la raíz mal devuelve **tabla vacía sin avisar** (toma `os.Args[2]`, no env).
- Costo: mantener = **material** (analizar 0; barrido 20k pagados + 156k de caché ≈ $1,69). Consumir:
  pregunta de prosa ~5k, de código ~40k, patológica 302k en 14 pasos con error (README:906, :1102).

**Conclusión.** El corpus SÍ es lo que Miguel describe: el ÁREA es el «hilo» (objetivo + qué se
deduce + archivos), la prosa está forzada por el lint a decir lo que el código no dice, y 24k palabras
para 557 archivos en 4 repos es magro. Lo que se está poniendo grande no es el corpus: es la
herramienta. Y el hilo está partido en dos mitades que no se apuntan: la prosa (182) y el área (85).

**Qué cambiar, en orden** — decisión de Miguel; nada escrito todavía:
1. **Enlazar sección→área en el mapa** (cada área lista las anclas que respalda). Determinista; de ahí
   salen gratis: qué prosa pierde el piso cuando muere un archivo, qué secciones no tienen respaldo, y
   qué archivos abrir para una pregunta (baja el costo de consumir, no sólo el de mantener).
2. Meter en el expediente por tema **las dos listas del dossier** (SUMAR por mismos-PRs+carpeta, QUITAR
   por ausente): 0 tokens, y el redactor ve las dos direcciones en la misma llamada.
3. **`retirar`** como operación que sólo viaja con un veredicto de prosa (`ya no`, o «la sección sigue
   sin ese archivo»), nunca sola.
4. **Podar la maquinaria**: un solo redactor (`revisarTema` con foco para el botón por tarea) y fuera
   `revisar`; fuera policy/tools/yo/relations y `-deriva`; que `-faltantes` falle a la vista; recuperar
   o retirar `-expediente <tema>` con sus dos skills; adelgazar el README.
5. **Crecer por DEMANDA, no sólo por código**: las 21 de soporte son cartera/pagos/comisiones y admin —
   se escriben, y `declarar` trae el mapa detrás. Y decidir si canon describe la FORMA de los datos
   (los 442 faltantes lo piden; `datos` tiene 14 archivos).

### 2026-09-01 · noche · 12 — el bucle no podía terminar (#60)

Miguel, mirando la pantalla después del barrido: «34 archivos en 10 temas, ¿no quedábamos al día?».
Eran **los mismos 34**: nada nuevo entró y nada se resolvió.

> **HALLAZGO · 2026-09-01** — el hash sólo se movía al reescribir prosa. Un `sigue` no movía nada, así que las 15 áreas releídas quedaban derivadas **para siempre**: cada vuelta releería lo mismo por $1,69. Y el único `ya no` (KYC) se corrigió, se mergeó, y sus tres archivos **siguieron marcados** — el integrador reescribió la prosa y dejó los hashes viejos.

La regla del guion («no mover un hash sin tocar la prosa») prohíbe un actualizador SUELTO, sin nadie que
haya leído. Un `sigue` de un redactor que tuvo el diff y el archivo delante ES esa lectura: tiene autor,
corrida, fecha y un PR que aprueba una persona. Decisión de Miguel: cerrarlo, y además igualar todo a
cero aceptando perder algo de contexto.

`Creditop-SAS/playground#60`: el borrador acepta `operacion: "verificado"` (sube el hash de lo que el
área YA declara, sin prosa, con procedencia); `proponer` aplica los `sigue` gratis; el integrador de
prosa cierra también sus archivos; y `canon -igualar` pone el residuo en cero **a mano, sin endpoint**
—una puerta remota que iguala todo sería el actualizador suelto que la regla prohíbe—.

> **MEDICIÓN · 2026-09-01** — igualado: 555 archivos declarados, 10 temas con hashes atrasados, **el residuo pasa de 34 a 2**. Los 2 son el mismo archivo (`kyc-pending-routing.ts`) declarado por dos áreas y borrado de main: se dejan a propósito, porque igualarlos borraría la única señal de que la prosa habla de algo que ya no existe. Es un `ya no` esperando.

Y la bandeja va vacía: sin analizar salía una fila por tema con deriva que nadie levantaba y se leía
como trabajo pendiente. Ahora es un ícono y una frase.

### 2026-09-01 · noche · 11 — el barrido completo: **$1,69** y una sola afirmación caída (#59)

> **MEDICIÓN · 2026-09-01** — barrido entero con #58: 10 temas, 34 archivos, 133k de material. **19.942 tokens pagados + 156k desde caché + 359k escritos en ella = $1,69** a tarifa de lista de Sonnet en Bedrock. Veredictos: **15 `sigue` · 9 `no alcanza` · 1 `ya no`**. El único `ya no` (el apellido en KYC) disparó su integrador solo, el banco rechazó su primera versión, corrigió y entró: commit en el PR sin que nadie apretara.
> **MEDICIÓN · 2026-09-01** — costo del día entero, todos los experimentos incluidos: ~6,3M tokens ≈ **$24**. Dos tercios fueron los errores (la vuelta uno-por-tarea y los integradores tanteando), no el trabajo.

**Costo de mantenerlo al día: $7/mes una vuelta por semana, $37/mes una por día hábil.** El 72% de una
vuelta es escribir la caché, que se paga una vez.

Dos defectos que el barrido destapó, los dos en `Creditop-SAS/playground#59`:

1. **Onboarding devolvió CERO veredictos** y eso se lee igual que un tema sano. Había concluido sus tres
   afirmaciones TRES veces, y las tres entregas se rechazaron enteras porque entre los archivos de un
   `no alcanza` nombró `kyc-pending-routing.ts` — que está en el material, mostrado por la ronda como
   «ya no está en main». Lo castigué por nombrar lo que le puse delante. Ahora se descarta la ruta y el
   hallazgo se conserva; cinco turnos en vez de tres, porque el rechazo es una entrevista.
2. **Siete de los nueve `no alcanza` eran `declarar`**: «esa lógica no está en el área, vive en X» — y
   nombran la X (`PreApprovedLenderService`, el `update()` del controlador de sucursales, el mapeo de
   CrossCore). No lo emitían porque les exigía `repo:ruta` y sólo vieron el NOMBRE en un import. Ahora
   `archivos` acepta el nombre suelto y el servidor lo resuelve contra el árbol de main (comprobado:
   `PreApprovedLenderService` → una sola ruta). Varias coincidencias devuelven opciones, no rechazo.

### 2026-09-01 · noche · 10 — #57 en prod: el costo aterrizó, y el expediente llegaba sin código (#58)

> **MEDICIÓN · 2026-09-01** — #57 en prod, la vuelta entera: analizar **0 tokens, 6 s** (19 tareas, una por área, 34 archivos). «Correr todas» por tema, 10 temas en 75 s: **11.237 tokens pagados completos**, más 36.835 servidos desde caché y 73.773 escritos en ella — la caché funciona (`cache_leida` > 0 donde hubo más de un turno). Contra 2,49M de la primera vuelta. Integradores: ninguno corrió, porque…
> **MEDICIÓN · 2026-09-01** — …**15 de 20 veredictos fueron `no alcanza`**, todos diciendo «no hay diff visible / no tengo el diff, sólo la lista de commits». Causa confirmada contra GitHub real: el mapa guarda el hash en 12 caracteres y la API de blobs exige 40 («The sha parameter must be exactly 40 characters»). En prod, sin clon, el pedido del blob viejo fallaba SIEMPRE y el error tiraba la ficha entera: sin diff y sin el archivo actual. En local `git cat-file` acepta el prefijo → el bug fue invisible en todas las pruebas.

`Creditop-SAS/playground#58`: el archivo actual se trae primero y por su ruta (siempre se puede); el
blob declarado es mejor esfuerzo; sin diff, el archivo va entero (tope 60k chars) y la ficha dice por
qué; el corte de «chico» sube de 250 a 600 líneas (con caché el material se paga una vez). Medido contra
GitHub real sin clon: el expediente de la vuelta pasa de 79k a **133k** con el código adentro.

Deuda que queda anotada: guardar el sha COMPLETO en los mapas nuevos para que el diff vuelva a existir
en prod (hoy `resolverArchivos` escribe `sha[:12]`; toca la ronda, el lint y las subidas de hash).

### 2026-09-01 · noche · 9 — un solo PR con el método eficiente (#57), probado en local

Miguel: «cancelemos los PR y dejemos uno solo; no más pruebas en prod hasta tener el método eficiente».
#52 ya estaba mergeado, #56 (caché) lo mergeó él, y quedó **#57** con las cuatro mejoras:

1. **El plan no usa modelo**: una tarea por área del mapa con deriva; el redactor por tema dice en `afirma`
   qué afirma la prosa y si el cambio lo invalida. El planificador con modelo (196k/vuelta) se borró.
2. **«Correr todas» va por tema.**
3. **El objetivo de un área declarada es lo que el código sostiene** (`afirma`), no la pregunta copiada.
4. **Los veredictos sobreviven a un despliegue**: la vuelta guardada lleva las corridas cerradas, con
   debounce de 20 s (en prod cada guardado es un commit). El estado local vive en el caché del usuario,
   fuera del repo — estar en el árbol ensuciaba `git status` y rompió el test de contrato.

> **MEDICIÓN · 2026-09-01** — local (3.7): analizar → 12 tareas, **0 tokens**, 15 s. «Correr todas» → 8 temas en 33 s, **59,6k** de redactores, cada hallazgo con afirmación concreta; un `ya no` → integrador 12k, propuesto. Tras reiniciar: las 12 `revisada` con su corrida.

Y una lección de proceso que me costó un commit rojo: `set -e` no mira un `go test` que va por un pipe.
Ahora los portones cortan con `tee` + `grep FAIL`.

### 2026-09-01 · noche · 8 — el circuito cierra en prod, y la respuesta a «¿por qué el chat gasta menos?»

> **MEDICIÓN · 2026-09-01** — onboarding en prod con #55: **61.798 tokens, 76 s**: un redactor para las 3 preguntas (2 `ya no`), **dos integradores de 2 llamadas cada uno** (18,8k y 20,3k), dos commits en el PR #53 sin que nadie apretara. El intento anterior sobre el mismo tema: 2,0M y nada escrito.
> **HALLAZGO · 2026-09-01** — la causa de fondo del costo vs. el chat de Claude Code: **canon no usaba caché de prompt**. Cada turno reenvía el historial entero y lo paga completo; el harness del chat cachea el prefijo y paga sólo lo nuevo (relecturas a ~10%). Mismo trabajo, 10–20× más caro, multiplicado por los turnos del tanteo. `Creditop-SAS/playground#56`: marcas de caché en herramientas, system, primer y último mensaje; `cache_leida`/`cache_escrita` contadas aparte. Pendiente de ver `cache_leida > 0` en prod.

Lo que queda anotado de #53 antes de mergearlo: la prosa nueva no nombra archivos (el lint aguantó) y
los dos commits reescribieron una sola región de onboarding; pero el área que `declarar` creó desde un
`no alcanza` tiene como **objetivo la pregunta del redactor** (con fecha y nombre de archivo) — defecto
del aplicador: para `no alcanza` el objetivo debe ser lo que la sección afirma, no la pregunta.

Regla de proceso que me anoto: **antes de gastar en prod, `gh pr view N` del PR del que depende**. Los
2,0M del integrador fueron correr sobre un #52 que nunca se mergeó.

### 2026-09-01 · noche · 7 — la vuelta en prod con el redactor por tema: 88.810 tokens (#55)

> **MEDICIÓN · 2026-09-01** — #54 en prod, 10 temas / 19 tareas, tema por tema: **los 19 redactores costaron 88.810 tokens** (contra 2,49M la vuelta anterior: **28 veces menos**), UNA llamada por tema, 13–34 s. El expediente pesado de antemano decía 79k. El costo es el material, no el tanteo — confirmado.
> **MEDICIÓN · 2026-09-01** — los integradores costaron **2,0M y no escribieron nada**: dos en onboarding (395k y 1,6M) con `escribir` rechazado 7 y 8 veces. Causa: **el PR #52 (la normalización de `escribir`) nunca se mergeó** y corrí la vuelta asumiendo que sí. Error de proceso mío.
> **MEDICIÓN · 2026-09-01** — veredictos: 11 `sigue` · 2 `ya no` · **8 `no alcanza`**. Leídos: casi todos dicen «los cambios son ajenos» o «no puedo re-verificar la cifra desde cero» — eso es `sigue`. El guion no distinguía «el cambio no toca esto» de «no me alcanza».

`Creditop-SAS/playground#55` (nace de la rama de #52, lo reemplaza): el integrador recibe la sección,
el expediente y las reglas del lint y sólo tiene `escribir`/`cerrar` (local: 2 llamadas, 12k, antes 49k);
la traza guarda los RECHAZOS con su motivo; aterrizar corta a los 2 pasos (así se llegó a 1,6M); el
redactor por tema concluye `sigue` cuando el cambio no toca la afirmación.

### 2026-09-01 · noche · 6 — el diseño estaba al revés: el redactor por tema (#54)

Miguel frenó las pruebas en prod: «un agente casi por archivo no debe pasar, 8 millones es mucho,
aterricemos». Tenía razón, y la medición lo dice sin discusión:

> **MEDICIÓN · 2026-09-01** — el residuo ENTERO de la vuelta de prod (34 archivos, 10 temas) armado como expediente —archivos enteros si son chicos, si no el diff; commits y PR; la prosa completa del tema— pesa **79k tokens** (de 4k arquitectura a 20k listado). Se gastaron **2,49M** revisándolo: **30 veces el material**. Medido con `canon -expediente`, sin modelo.

La causa no era el número de agentes sino la DIRECCIÓN: el redactor tenía herramientas para ir a buscar
código y las usaba —siete búsquedas con regex sobre un `Kernel.php` de 400 tokens— y cada turno reenvía
todo el historial. El expediente ya se le daba entero; con una búsqueda a mano, la usaba igual.

`Creditop-SAS/playground#54`: **un redactor por TEMA** recibe el expediente completo más TODAS las
preguntas del plan sobre ese tema, sin herramientas, tope 3 turnos, y los hallazgos se registran por
tarea con el mismo agente y firma — tarjetas, `proponer` y PR no notan el cambio. `canon -expediente`
acota el costo antes de correr. Convive con la forma de a uno mientras se mide.

> **MEDICIÓN · 2026-09-01** — en local (3.7): un redactor por tema, UNA llamada cada uno, costo = expediente (5k por 4k de material; 12k por 11k), veredictos en sus tarjetas, el `ya no` propuso solo. ⚠ Local NO muestra el ahorro: 3.7 tampoco tanteaba en la forma vieja (6k y 13k en una llamada). El tanteo es de Sonnet; el 79k contra 2,49M se confirma en prod o no.

### 2026-09-01 · noche · 5 — #51 en prod: el integrador, por fin con traza (#52)

> **MEDICIÓN · 2026-09-01** — el deploy de #51 reinició otra vez: el plan volvió de la rama (17 ids) y los veredictos se perdieron por segunda vez. **Persistir las corridas cerradas junto al plan ya duele: sube al ítem 1 como siguiente paso.**
> **MEDICIÓN · 2026-09-01** — una tarea (onboarding, `ya no`) con la escritura automática: el redactor concluyó y el integrador corrió SOLO — y se cayó igual, 18 pasos, **506k tokens la corrida**. Pero con traza: `leer` 4 · `codigo` 7 · **`escribir` 7, las 7 rechazadas** · `cerrar` 4. Reproducido en local: el rechazo era del LINT — «`kyc-processing.tsx` es un archivo: es una dirección y caduca» —. El integrador copiaba el nombre del archivo del veredicto a la prosa, y el guion nunca le dijo que no se puede. Además adivinaba el contrato (`id=`, `node` sin `/context`, título adentro del texto).

`Creditop-SAS/playground#52`: el guion dice la regla antes de escribir, y `escribir` normaliza lo que
el modelo manda (acepta `id#ancla`, completa `/context`, saca el `## título`; sólo `texto` obligatorio).
Regresión local: dos `ya no` a la vez propusieron solas, con el candado poniendo los commits en fila.
⚠ Que Sonnet deje de nombrar archivos por decírselo NO está probado: se mide en la próxima vuelta; si no
alcanza, el paso siguiente es quitar los nombres del texto antes de mandarlo al lint.

### 2026-09-01 · noche · 4 — «correr las 17» en prod, y el giro a la escritura automática (#51)

> **MEDICIÓN · 2026-09-01** — 17 redactores en prod con «correr todas»: **2,49M tokens** (el estimado eran 2,5M). Veredictos: 12 `sigue`, 1 `ya no`, 6 `declarar`, 5 `no alcanza`. **Cinco de los seis archivos nombrados para declarar NO existían en main** (rutas inventadas a partir del nombre de una clase); el único real, `FirstSurname.php`, entró al PR #50. El integrador de prosa **agotó los 18 pasos** con 140k tokens y no dejó traza.
> **MEDICIÓN · 2026-09-01** — la guarda del hash de #49 actuó en prod: tres `declarar` nombraron archivos ya declarados y quedaron sin botón; sin ella habrían subido tres hashes sin releer.

Miguel decidió el giro: confiar en el veredicto y que el cambio vaya al PR solo. Construido y probado en
local en `Creditop-SAS/playground#51`: `proponer` corre dentro de la corrida del redactor al concluir
seguro; un candado pone los commits en fila; la consolidación sale de la pantalla; la traza se guarda
también al caer (integrador, redactor, verificador); `concluir` rechaza archivos que no existen en main.

### 2026-09-01 · noche · 3 — #49 mergeado y validado en prod

> **MEDICIÓN · 2026-09-01** — el deploy de #49 reinició el proceso y **la vuelta volvió de la rama**: «recuperado de la rama canon/contexto», los mismos 17 ids, `cubiertos` 31. Es el ítem 1 probado contra un despliegue real, no simulado.
> **MEDICIÓN · 2026-09-01** — `/api/pr` ya no da 403: contesta `abierto: false` limpio (no hay PR porque nadie propuso todavía).

Lo que se perdió con el reinicio, como estaba escrito: la corrida de `p4109f3` y su veredicto — las
corridas no se persisten. La tarea volvió a `lista`. Es el trade-off documentado en el ítem 1; si duele,
el siguiente paso es persistir las corridas CERRADAS junto al plan.

Pendiente de ver en prod: la guarda del hash (sólo se ejercita cuando un `no alcanza` nombre archivos
ya declarados) y el estimado de costo en el botón (aparece con la primera tarea corrida de la vuelta).

**Decisión abierta (Miguel):** correr las 17 con «correr todas» son ~2,5M tokens al costo medido
(150k/tarea). La alternativa es correr 3 o 4 a mano, medir, y decidir con el estimado en el botón.

### 2026-09-01 · noche · 2 — el header cuenta la vuelta, y «correr todas» dice lo que cuesta

Pedido de Miguel antes de mergear #49, construido y probado en local (mismo PR): el chip del header
pasa a «PR #n · k commits +a −b» y despliega la lista de commits —uno por corrida, más el del plan—;
`POST /api/tareas/correr-todas` levanta las que faltan DE A TRES (el tope de diez protege al servidor,
esto protege el bolsillo) y el botón lleva el costo estimado con el promedio MEDIDO de esta vuelta, o
dice que todavía no hay medida; filas a dos líneas; barra de avance en «La vuelta».

Hueco que salió probando la persistencia: el PR lleva `.vuelta.json` y al mergear queda en `main`; la
rama siguiente nace con él y el arranque lo habría leído como vuelta viva. Ahora un plan de la rama
sólo cuenta si su blob difiere del de `main`.

Y una observación del CI del repo compartido, fuera de esta tarea: `Revisar herramientas` corre `task ci`
sobre TODAS las herramientas —construye la imagen de credibot, cuadrilla y home en un PR que sólo toca
canon—. Es lo que Miguel vio como «`tools/credibot` en el PR». Candidato a acotar `task ci` a las
herramientas cambiadas; es decisión del repo, no de canon.

### 2026-09-01 · noche — PRIMERA VUELTA EN PROD (después de mergear #48)

> **MEDICIÓN · 2026-09-01** — planificador en prod: 32 archivos en 10 temas → **17 tareas en 74 s, 196k tokens**. Ids estables, `cubiertos` 31/32, `.vuelta.json` de 16 KB en `canon/contexto` **sin abrir PR**.
> **MEDICIÓN · 2026-09-01** — un redactor (`p4109f3`, arquitectura, 2 preguntas, 1 archivo): **53 s, 150k tokens, aterrizaje forzoso a los 120k**. 11 llamadas: `cambios` 1, `historia` 1, **`codigo` 7** (una rechazada por tope) sobre la MISMA área con regex cada vez más largas — nunca leyó el archivo entero. Concluyó `sigue` · `no alcanza` (con `archivos`) · `nada que declarar`.

Dos hallazgos, los dos en `Creditop-SAS/playground#49`:

1. `/api/pr` contestaba **403**: buscaba el PR con el token de LECTURA y listar PRs pide `Pull requests`,
   que sólo tiene la App que escribe. Local no lo mostró: el GitHub falso no revisa permisos en los GET.
2. El `no alcanza` nombró **exactamente los archivos que el área ya declara**, diciendo que no pudo
   leerlos por presupuesto. Con lo que había, `proponer` los habría «declarado» y el borrador trata un
   archivo ya declarado como **subirle el hash** — nivel 2 del guion, sin que nadie releyera. Y lo puse yo
   a un click (ítem 5). Ahora una pieza que sólo declara nunca sube un hash (409 si no hay nada nuevo),
   cada hallazgo trae `archivos_nuevos` y la pantalla decide «pide algo» por eso.

**Para el ítem 6, ya hay dato**: el redactor gastó el presupuesto BUSCANDO con `codigo` (7 veces, misma
área) cuando la pregunta —«¿cuántos comandos agenda el Kernel?»— se contesta leyendo el archivo una vez.
La primera palanca es la (a) del plan: que tenga cómo leer el archivo entero y no sólo fragmentos por
regex. Confirma también que la ley de costo aplica: 11 turnos → 150k.

### 2026-09-01 · tarde

Se construyeron los ítems 1, 2, 3, 4, 5, 7, 8 y 9 en #48 (commit «ocho mejoras del backlog»), probados
en local contra el GitHub falso: plan recuperado de disco y de la rama tras reiniciar; analizar no abre
PR; `cubiertos` 1 y 3 para tareas de 1 y 3 archivos; «11 en cola» sobre 15; `docker build` con `-race`
en verde. Dos cosas que no estaban en el plan y salieron construyendo: el número de área se resuelve por
objetivo (ítem 2), y mi `pkill -f '/tmp/canon-'` mataba también al GitHub falso — ahora corre como
`/tmp/gh-falso`. El ítem 6 queda para después de medir.

### 2026-09-01

Se validó cada ítem contra el código o contra una medición antes de listarlo. Salieron dos defectos de
lo escrito ese mismo día y se arreglaron en el PR antes de listar: la consolidación contaba
integradores de vueltas anteriores, y `enCola` dependía del formato libre del planificador (ése queda
como ítem 2 porque el arreglo bueno es del lado del servidor). Se descubrió que CI no corre `-race`.

## Tarea (publicable)

## En una línea
Dejar el bucle que mantiene la documentación técnica al día listo para operarse en producción sin
sorpresas: que una vuelta no se pierda con un despliegue y que se sepa cuánto cuesta antes de correrla.

## Por qué
Hoy una vuelta a medias se pierde si el servicio se reinicia, y el costo de correrla sólo se conoce
después. Eso hace que nadie la corra con confianza.

## Qué cambia
La vuelta sobrevive a un despliegue, la cola de cambios nuevos es exacta, y el panel muestra el costo
acumulado antes de que alguien decida gastar.

## Alcance
No entra el disparo automático: la vuelta la inicia una persona.

## Dónde probar
Ambiente de la herramienta interna, pantalla de agentes.

## Cómo validar
Analizar, correr una tarea, reiniciar el servicio: la tarea y su conclusión siguen ahí.

## Criterios de aceptación
Una vuelta iniciada antes de un despliegue se puede terminar después de él sin volver a analizar.

## Dependencias / contraparte
Mergear el PR abierto de la herramienta antes de medir en producción.
