---
id: 72
title: "Canon: las mejoras del bucle de agentes, validadas y con plan"
stage: work
created: "2026-09-01T15:30:00-05:00"
context_nodes: []
jira: []
ramas: agentes/declarar-es-mecanico
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

**El próximo paso es:** mergear #54 y correr UNA vuelta en prod con la forma nueva, tema por tema
(`POST /api/tareas/tema/{tema}`), anotando el costo real contra los 79k del expediente. Si se confirma:
«correr todas» pasa a ir por tema, y el integrador recibe el mismo tratamiento (hoy 49k por sección en
local con herramientas; en prod se cayó dos veces tanteando). Después, persistir las corridas cerradas.

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
