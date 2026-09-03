---
id: 72
title: "Canon: las mejoras del bucle de agentes, validadas y con plan"
stage: work
created: "2026-09-01T15:30:00-05:00"
context_nodes: []
jira: []
ramas: canon/contexto-de-lo-que-entro, agentes/el-declarar-lleva-su-seccion, agentes/paso-4-adelgazar, escritura/para-el-equipo, lectura/consultar-barato, equipo/capa-operar, datos/diccionario-de-tablas, corpus/la-cuota-y-el-aval, corpus/la-tabla-que-nadie-escribe, fix/el-primer-area-de-un-tema-abierto
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Canon (`Creditop-SAS/playground`, `tools/canon`, `canon.playground.creditop.com`) tiene un bucle de
cinco labores que mantiene el corpus al día con `main`: triaje → planificador → redactor → integrador
→ verificador, manual desde la pantalla `agentes`. **Al 2026-09-02 el ciclo cierra completo en prod:**
merge en los repos → ronda → analizar (0 tokens) → redactor por tema (una llamada, ~4k tokens) → prosa
corregida + hash subido + **ruta muerta retirada** + archivo nuevo declarado → un PR que revisa una
persona (#68 fue el primero). Los pasos 1 (poda), 2 (el hilo sección→área: 128 de 169 secciones con un
área detrás) y 3 (`retirar`) están mergeados y desplegados (#59…#71).

**El paso 4 —adelgazar la herramienta— está ENTERO en `Creditop-SAS/playground#72`, en verde, sin
mergear:** README 16.234 → 2.667 palabras (la historia en `docs/HISTORIA.md`) · `.vuelta.json` fuera de
los PRs y del repo (vive en la rama `canon/estado`) · fuera `verificado_contra`, `-temas`, `LocalLag` y
la guarda de modelo de analizar. Cinco commits, uno por pieza; humo y dictado en verde.

**#72 y #73 están mergeados y desplegados** (2026-09-02): prod corre el paso 4, la rama `canon/estado`
nació con el primer `analizar`, y el PR del bucle se arregló trayendo `main` en vez de descartar la vuelta.

**#74 —la API de ESCRITURA para el equipo— está mergeado y desplegado** (2026-09-02, 19:23) y validado en
prod: el catálogo dice que escribir existe, la nota del borrador dice qué pasa al cerrar, el 422 de un
archivo que no está en main explica cómo declararlo desde un PR abierto, y `/api` trae `para_tu_agente`.

**#75 —CONSULTAR BARATO— mergeado y desplegado** (2026-09-02, 20:07), medido en prod (Registro 27). Salió de la pregunta
de Miguel «¿podemos hacer consultas eficientes?». Medido contra prod: `/api/pregunta` ya era razonable
(una llamada, 10–17 s, con citas, 80–90 % del prompt de caché); la grasa estaba en el camino léxico. Una
sección viaja sólo con las áreas que la respaldan (25 KB → 7,8 KB), la búsqueda acota y no repite
(36,9 KB → 17,6 KB), seis resultados por defecto, el agente que contesta recibe el texto del primer
resultado, dos objetivos kilométricos reescritos, y el skill enseña lo barato y la trampa del `%23`.
El ranking no cambió: bench 92/115 · 115/115 · 115/115.

**#76 (la capa `operar`) y #77 (el diccionario de tablas y las tablas declaradas por área) están MERGEADOS
y VALIDADOS EN PROD** (2026-09-03, 12:05 y 12:20 UTC). Prod sirve 19 nodos: los cuatro temas operativos
—ambientes, local, repos, observabilidad— con sus secciones, el diccionario de 235 tablas en 13
vecindarios, y las búsquedas por nombre de tabla devolviendo las áreas que la declaran. Medido en prod: la
sonda de 16 preguntas del equipo pasó de **4 a 15 al primer resultado**, y «en qué tabla queda el estado de
una solicitud» la contesta el agente en **2 pasos y 7 s** con citas, contra los 4 a 9 pasos de antes.

**#78 —el tema de la CUOTA— está mergeado y VALIDADO EN PROD** (2026-09-03, 12:53 UTC). Prod sirve 20
nodos. Las seis preguntas que nadie contestaba caen en el tema nuevo: cinco con `cuota` primera y la sexta
en dos pasos. Y el agente contesta «le cobraron una cuota inicial mayor a la que dice la política» en 4
pasos y 14,7 s, respaldada con las dos secciones, explicando los dos orígenes del porcentaje y las dos
bases. Soporte pasó de 21 a 15 sin cobertura; el banco del equipo, a 26/26.

**#79, #80 y #81 están mergeados** (2026-09-03). El #79 traía el bug del candidato, la tabla de 301.690
filas que escribió un script de migración y los 18 `que_es`. El #80 fue el **primer dictado de verdad**
—tres secciones de lo que entraba a main, entradas por la API de escritura— y el #81 los dos bugs que
ese dictado encontró: el empalme dejaba una coma antes del primer elemento de un `areas` vacío (rompió
el build de main) y un tema nacido en el mismo cierre no podía recibir áreas.

**Lo último, y es lo que hay que saber al retomar: `Creditop-SAS/playground#82` está en verde y SIN
MERGEAR.** Salió de un ensayo que pidió Miguel: hacer de cuenta que somos un dev del equipo y
contextualizar canon por la API con lo que acababa de entrar a main, todo en local. El ensayo funcionó de
punta a punta y dejó tres cosas:

- **dos secciones dictadas y verificadas contra `legacy-application`**: hasta cuándo se puede cambiar el
  país de un comercio o de una entidad (y que cambiarlo no arrastra a sus sucursales), y el canal de
  origen de un pago con las tres cosas que sesgan cualquier conteo — texto libre, «web» como valor por
  omisión, y el registro manual que hereda el canal o queda vacío;
- **la guarda de puertos de los dos arneses**: le pegaban al servidor de otro proceso si el puerto estaba
  ocupado, y el chequeo de salud pasaba igual. Costó dos fallas falsas y podía costar un verde falso;
- **la apertura de `internacionalizacion` reescrita**: decía que el tema no tenía código declarado y ya
  tiene dos áreas.

Queda en pie el inventario: **76 archivos declarados cambiaron en 16 temas** (onboarding 22, listado 13,
datos 7, altas 6), 15 preguntas de soporte sin cobertura, 2 del equipo, y 175 tablas sin área.

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

### 2026-09-03 · el ensayo de contextualizar por la API, hecho de verdad y en local (#82)

Miguel pidió simular la agregación de contexto **usando la API como si fuéramos un desarrollador**, con
main ya actualizado en local, para dejar el corpus al día con lo que acababa de entrar. Se hizo así,
completo, y el camino de escritura aguantó.

**Lo que se detectó.** La ronda contra los clones locales dio **76 archivos declarados cambiados en 16
temas** (onboarding 22, listado 13, datos 7, altas 6). De ahí se eligieron dos mecanismos que el código
no dice en ningún archivo suelto, se leyeron en `legacy-application` y se dictaron.

**Lo que se dictó, y contra qué se verificó.** El país de un comercio se puede cambiar mientras no haya
originado nada; el de una entidad, mientras no tenga comercios ni solicitudes, salvo que esté en un país
donde no operamos. La regla anterior exigía además que el comercio no tuviera sucursales, y eso dejaba
sin salida el caso más común al abrir un país: **26 comercios con sucursales y sin una sola solicitud**
quedaban bloqueados contra 27 que sí eran editables. Y el canal de origen del pago: texto libre de 255,
«web» por omisión, y el registro manual que lo hereda de la pasarela o queda vacío — así que **contar por
canal subestima siempre**.

**Una palabra, medida.** La sección del país decía «corregir» y la pregunta natural dice «cambiar». La
búsqueda la devolvía primera igual, pero con la etiqueta «probablemente el corpus no tiene esto todavía»,
que es peor que no encontrarla: un agente la lee y contesta que canon no lo sabe. Cambiada la palabra, la
cobertura pasó de **0,5 a 0,75** y la advertencia falsa desapareció. Es la misma lección de vocabulario en
los títulos, ahora con número.

**El hallazgo del día no era del corpus, era del arnés.** `dev/dictado.py` reportó dos fallas que no
existían. Causa: arranca sus servidores en **puertos fijos** (8595/8596) y mi ensayo los tenía ocupados,
así que el `Popen` falló dentro de su propio log y **el chequeo de salud pasó igual, contra mi servidor**.
El arnés midió otra cosa y no lo dijo. Peor que la falla falsa es el **verde falso**, que es el mismo
mecanismo al revés. Ahora hay un `connect` antes de compilar, **fuera del `try`** (adentro, su `sys.exit`
corría el `finally` y el resumen imprimía «todo bien» con cero comprobaciones — el verde falso que la
guarda venía a evitar). Y de paso: al GitHub falso **no lo esperaba nadie**, sólo se esperaba el `/health`
del servidor; como arranca en ~50 ms casi siempre llegaba, y cuando no llegó el fallo salió cuatro
comprobaciones más tarde disfrazado de «no se pudo declarar el archivo», con el `connection refused`
metido dentro de un 422 de la API.

**Dos secciones dictadas al final del mismo tema CHOCAN.** Mi pieza y la del #80 se agregaron las dos al
final de `internacionalizacion`, y el rebase dio conflicto en el `.md` y en el `map.json`. En el JSON el
conflicto cae **dentro de un mismo objeto**, así que pegar texto no funciona: se resolvió leyendo los dos
archivos completos con `git show`, uniendo las áreas y **parseando antes de escribir**. Es la misma
lección que el bug del empalme del #81 — un `map.json` no se edita por texto.

**Comprobado:** lint 20 nodos / 218 secciones en orden · bench 93/115 al primer resultado y 115/115 entre
los tres primeros, igual que antes · soporte 123/124 y equipo 26/26 sin cobertura perdida · `go test` en
verde · dictado 54 comprobaciones tres veces seguidas · humo en verde · y con el puerto ocupado a
propósito, el arnés aborta con código 2 y **sin** decir «todo bien». Las dos secciones salen **primeras**
para su pregunta natural y pesan ~3,5 KB con su área detrás.


### 2026-09-03 · tarde · 37 — el ensayo de dictar como un dev: tres piezas y DOS bugs que rompen main (#80, #81)

Miguel: «van a llegar 3 cambios grandes a main que tocan varios repos… ¿te parece si simulamos la agregación
de contexto usando la API como si fuéramos un desarrollador?». Sí, y fue el ensayo más productivo del día:
salió contexto útil y salieron dos defectos que ninguna prueba había tocado.

**Lo que se dictó, verificado leyendo las ramas y los PRs** (no de memoria):
- **SmartPay, el teléfono del asesor.** Cuando el cliente no tiene teléfono el asesor origina con el suyo, y
  al guardarlo se le pega un token de unicidad con la hora al microsegundo. La consecuencia: **lo que está en
  la columna del celular NO es un número marcable**. De ahí dos reglas opuestas que van juntas: en toda
  frontera de SALIDA hay que quitar el token; en el valor que se GUARDA y en cualquier clave de BÚSQUEDA hay
  que dejarlo. Medido el 2026-08-27: el bypass de código para pruebas se decidía con la forma guardada, así
  que nunca coincidía con la lista de exentos y el asesor quedaba esperando un código que no llegaba.
- **Internacionalización, el documento.** El número de documento es único SOBRE LA COLUMNA SOLA: los países
  comparten un espacio de numeración. 119.188 documentos de ocho dígitos ocupados y **85.601 números que un
  peruano no va a poder usar**; el alta responde «documento ya en uso» en el primer paso. Y había CUATRO
  guardas que no se comportaban igual, por eso el diagnóstico era difícil.
- **El corte por país del listado.** A un comercio le salen las entidades de su país **más las del país 1**,
  que es el valor por omisión con el que quedaron casi todas. O sea: **abrir un país no alcanza con crear su
  comercio y su entidad** — hay que mover las entidades viejas a su país o el cliente nuevo verá ofertas que
  no le sirven. Y el corte vive escrito dos veces en el mismo servicio.

**Los dos bugs, los dos en el caso más natural (documentar algo nuevo con su código):**
1. **La primera área de un tema abierto rompía el JSON.** `"areas": []` + el splice que pone «,\n» antes del
   primer elemento = `"areas": [,{…}]`. Las tres piezas pasaron lint y banco AL ENTRAR —esas guardias miran
   la prosa— y el mapa inválido se produjo AL CERRAR: llegó al PR y **rompió el build de main**. Arreglado, y
   ahora el splice **comprueba su resultado parseando**, como ya hacía el retiro.
2. **Abrir un tema y declararle archivos en el mismo borrador daba 500**: el splice leía el disco y el mapa
   nace en ese mismo cierre. Ahora parte del mapa recién generado.

⚠ **Y lo peor, que explica por qué no salieron antes: el arnés decía «todo bien» habiendo muerto.** El
`finally` termina en `sys.exit`, y **un `sys.exit` ahí DESCARTA la excepción en curso**. Corrían **36 de 54**
comprobaciones —las 18 de operar y tablas no se ejecutaban— y reportaba éxito. La causa de la muerte era
chica: la salida de `-ronda` se decodificaba en estricto y la ronda recorta contando bytes, así que cortaba
una tilde por la mitad. Ahora la excepción es una falla, se imprime la traza, y **se dice cuántas
comprobaciones corrieron**: un número que baja delata una fase saltada.

> **MEDICIÓN · 2026-09-03** — dos guardias atajaron EN VIVO contra prod, antes de escribir nada: el banco
> rechazó dos versiones de mis piezas por robarle el camino a preguntas que el corpus ya contestaba
> («por qué todos aparecen como empleados» y «el listado no sale y no hay ningún error»). Reescritas, entraron.
> Y el `pr` de una pieza **no funciona contra los repos de código**: `403 al pedir el PR
> Creditop-SAS/legacy-backend#1279` — a la App de canon le falta el permiso de leer pull requests.

### 2026-09-03 · mañana · 36 — #79 en prod, y el agente contesta bien SIN citar

Mergeado a las 14:07, deploy en verde. La sección nueva está en `datos` con su área, que declara el script
de migración con su hash y la tabla. Los 18 `que_es` se sirven por `/api/tablas/<nombre>` y en la búsqueda.

⚠ **La primera medición me mintió y casi reporto un bug que no era.** Pedí seis `que_es` y tres vinieron
vacíos, en alternancia perfecta: era el **relevo de tareas del despliegue** —unas respuestas de la tarea
vieja y otras de la nueva— y el mismo efecto hizo que un `read` por ancla devolviera `nodes: null`. A los
tres minutos, los seis correctos. **Durante el rollover, prod contesta dos versiones a la vez: medir ahí es
medir ruido.** Ya sabía que tarda ~4 minutos y aun así lo pisé.

> **MEDICIÓN · 2026-09-03** — `/api/tablas/user_request_risk_central_verified` en prod: `filas_aprox`
> 276.696 (la estimación) con su `que_es` diciendo las 300 mil contadas, vecindario solicitud, **tema
> `datos#5` vía declarada, y `modelos` vacío** — que es exactamente el hallazgo: ningún modelo la
> representa. El hilo completo, de la tabla al script, servido por la API.

**Y un hallazgo del agente, para el PR del guion:** le pregunté «tiene 300 mil filas pero no encuentro quién
la escribe, ¿está muerta?». Contestó **exacto** en 3 pasos y 13 s —no está muerta, la escribió un script de
migración, ningún servicio la mantiene, y hasta distinguió las 301 mil contadas de las 276 mil estimadas—
pero con **`citas: []` y `respaldada: false`**: leyó el tema entero y no citó ninguna sección. La guardia
hizo su trabajo (marcó la respuesta como no respaldada en vez de fingir respaldo), pero el agente tenía la
cita en la mano y no la usó. Va con lo del guion: hoy le dice «leé una sección entera» y no le exige copiar
el ancla de lo que leyó.

### 2026-09-03 · mañana · 35 — «¿algo más que corregir?»: un bug del dictado, la tabla del script, y el campo que se borraba (#79)

Miguel preguntó si había algo más que agregar o corregir. Había tres cosas, y una era un bug que iba a
morder al primer dev que dictara con un PR de corpus abierto.

**1 · El dictado culpaba al ancla.** El candidato que pasa por el lint se arma con el `.md` de una fuente
—disco, rama del bucle, embebido— y con las áreas del corpus VIVO. Si el vivo está adelantado respecto de
esa base (o sea: cualquiera escribiendo con su PR pendiente), hay áreas que declaran secciones que el
documento base no tiene, y el lint del candidato rechazaba la pieza con «no pasaría el lint» culpando a un
ancla que SÍ existe. **Me costó tres corridas del arnés**, porque el arnés imprimía el titular del rechazo
y se comía `problemas`. Arreglado sin debilitar la regla: el candidato OMITE el enlace que su documento base
no sostiene; el área queda intacta en el mapa. Con prueba de regresión. Y el arnés ahora imprime el detalle
de cada rechazo — ocultarlo fue lo que hizo perder las tres corridas.

**2 · La tabla de las 301.690 filas, corregida.** Ayer la di por «sin escritor y quizá vacía»; las dos
mitades estaban mal. La escribe **un script de migración de datos del repositorio del backend** (una
herramienta de escritorio, julio de 2025): arma la lista de solicitudes sin el vínculo a su reporte del
buró, las cruza por persona y fecha, y las marca de una sola vez. Ningún servicio la toca y **la base no
tiene ningún disparador** (verificado contra `information_schema.triggers`: sin filas). Al tema `datos`, con
lo que importa: rompe las dos conclusiones fáciles —«tiene filas, alguien la mantiene» y «no está en el
código, está muerta»— y la pregunta correcta es quién la escribió y quién la lee HOY.

**3 · 18 `que_es`, y que el generador no los pise.** Llené la línea de la espina, las de volumen y las que
ENGAÑAN. Y el defecto que las habría borrado: `que_es` es la única línea que escribe una persona y el
generador reescribe el JSON entero. **Es el mismo modo de falla de `verificado_contra`**, que decía
«pendiente» para siempre: un campo que el generador pisa no es un campo, es un borrador. Ahora los preserva
y dice cuántos; probado regenerando.

> **MEDICIÓN · 2026-09-03** — lint ✓ 20 nodos · 213 secciones · 59 de 235 tablas con dueño. Bench 93/115 ·
> 115/115. Soporte 123/124 con 15 sin cobertura. Equipo 26/26. `-race` 0 · `unused` 0 · humo y dictado todo
> bien. #79 en verde.

⚠ **Y la regla va CUARTA vez**, así que quedó escrita en el skill de documentar: escribir esto le robó el
mapa a la pregunta del buró porque el `objetivo` del área nueva decía «buró». El `-bench` lo cazó como SIN
CAMINO, que bloquea; se reenfocó el objetivo en lo que el área es y volvió. **Agregar texto diluye el
ranking de lo que ya estaba**: después de escribir, los tres bancos.

### 2026-09-03 · mañana · 34 — #78 en prod: las seis preguntas contestadas, y una que sigue fallando por su nombre

Mergeado a las 12:53 UTC, deploy en verde, prod con 20 nodos.

> **MEDICIÓN · 2026-09-03** — las seis preguntas de soporte, contra prod. Cinco tienen `cuota` como primer
> resultado: «no le está calculando el aval» y «no tomó los costos administrativos» → «La cuota se arma en un
> orden»; «no se le suma el IVA al FGA» → «El impuesto del aval está fijo en el código»; «le cobraron una
> cuota inicial mayor» → «La cuota inicial se calcula en dos lugares». «No me sale la cuota inicial» cae
> primero en el puntero de `formalizacion` y llega en el segundo. Cobertura entre 0,67 y 1.
> **MEDICIÓN · 2026-09-03** — `/api/pregunta` con «un comercio dice que le cobraron al cliente una cuota
> inicial mayor a la que dice la política, qué le contesto»: **4 pasos, 14,7 s**, respaldada con las DOS
> secciones nuevas, y la respuesta arranca por lo que importa —que las dos explicaciones pueden ser ciertas
> a la vez— y enumera los tres pasos de verificación en orden. Eso es exactamente lo que soporte necesita.
> **MEDICIÓN · 2026-09-03** — el glosario traduce: «qué es el aval», «qué significa FGA» y «qué es la fianza
> del crédito» devuelven las tres la entrada «Aval · fianza · FGA · fondo de garantías». Y
> `guarantee_acceptances` sale con su área: `cuota/context#1`, vía **declarada**.

**La que sigue fallando, y por qué:** «mediarte pide que este cliente salga sin fondo de garantías» cae en
`onboarding` con cobertura 0,43. La pregunta nombra un comercio y pide una acción de configuración («salga
sin»), no explica un cálculo: la respuesta es poner en cero el porcentaje del aval de esa fila comercio-
entidad, y eso el tema no lo dice como instrucción. Es una pregunta de `altas` —cómo se cambia esa
configuración—, no de `cuota`. Queda anotada como la próxima.

### 2026-09-03 · mañana · 33 — crecer por demanda: el tema de la cuota, y el vocabulario que roba caminos (#78)

Miguel: «ahora trabajás con un modelo mejor que el de Bedrock; ¿qué tal si con el contexto que tenés tratás
de mejorar el corpus? Yo lo veo muy bien, pero si ves que podemos agregar más cosas sería genial». El lugar
más rentable estaba medido desde hacía días: las 21 preguntas de soporte marcadas `SIN COBERTURA`. **Seis
eran sobre lo mismo** —aval, IVA del aval, cuota inicial, costos administrativos— y todas se contestan
leyendo el mismo cálculo.

**Lo escrito, verificado contra `main` el 2026-09-03** leyendo el cálculo del plan de pagos, el servicio del
aval, el del enganche, el de la categoría y el del bloqueo del equipo:
- **El orden de los cobros explica tres reclamos.** Administrativos sobre el monto COMPLETO; el aval sobre
  monto MÁS administrativos (no sobre el monto pelado); ese total es la base de la amortización; y el seguro
  de vida y el aval fijo por millón se suman DESPUÉS, así que **esos dos no generan interés y los otros sí**.
- **El IVA del aval está fijo en 19 % en el código**, con la única excepción del país. Y la trampa: la fila
  comercio-entidad TIENE una columna de impuesto que el aval NO usa (la lee el cobro del bloqueo del
  equipo), así que cargarla no cambia nada.
- **La cuota inicial se calcula en dos lugares con dos bases y dos orígenes**: el porcentaje del mínimo de la
  categoría o del tramo de monto; y la base es monto+administrativos en el plan de pagos contra el monto
  pelado en el cobro. Con administrativos en cero coinciden. Es «le cobraron más de lo que dice la política».
- **La tasa no es proporcional en los tres cortes**: mensual, la mitad en quincenal, conversión efectiva en
  semanal. Y el aval tiene **cuatro nombres** (aval · fianza · FGA · fondo de garantías), uno por cada lado.

> **MEDICIÓN · 2026-09-03** — soporte: **117/118 con 21 sin cobertura → 123/124 con 15**. Equipo: 22/22 →
> **26/26** (+4 preguntas del aval y el enganche). Ruteo: 92 → **93** al primer resultado, 115/115 en top-3.
> Lint 20 nodos · 212 secciones. `-race` 0 · humo y dictado todo bien. Las seis preguntas probadas una por
> una contra el servidor local: cinco caen directo en el tema nuevo, la sexta llega en dos pasos.

⚠ **Lo que más se aprendió, y es de método:** escribir **le robó el camino a dos preguntas del banco, las
dos veces por vocabulario**. Mi prosa decía «el producto no existe» hablando del aval en otro país, y eso le
quitó el top-3 a «cuánto cuesta agregar otro producto de bancolombia» — el bench lo cazó como SIN CAMINO,
que bloquea. Cambiado por «ese cobro», volvió. Y la primera versión de las dos entradas del glosario era el
doble de larga: le quitó el camino a «por qué no le apareció esta entidad al cliente». Acortadas, volvió.
**Agregar prosa con palabras comunes DILUYE el ranking de lo que ya estaba.** Tercera vez en dos días que el
vocabulario, y no el buscador, decide el ruteo. El bench no es burocracia: es lo que hace que escribir no
rompa lo que ya funcionaba.

**Y por qué un tema nuevo:** `formalizacion` llegó a 3.074 palabras contra un techo de 3.000, que es
exactamente cuando el lint pide partir. La cuota es un asunto propio y queda sitio para lo que falta (pago
mínimo contra saldo, los administrativos en el reporte). En `formalizacion` quedó un puntero de una línea.

**Higiene hecha:** borradas las ramas mergeadas —seis `canon/*` y veintinueve `agentes/*`— y **`canon/estado`
NO**: es la rama de estado del bucle y el chequeo de ancestro la frenó, que era justo su trabajo.

### 2026-09-03 · mañana · 32 — #76 y #77 en prod: de 4 a 15 de 16, y la pregunta de tabla en 2 pasos

Miguel mergeó los dos (12:05 y 12:20 UTC) y los dos deploys quedaron en verde. Validado contra prod:

> **MEDICIÓN · 2026-09-03** — **la sonda de 16 preguntas del equipo: 15 al primer resultado** en un tema
> que contesta, contra **4** antes de la capa operativa. Los cuatro temas nuevos responden lo suyo:
> «qué ambientes hay» y «cómo se despliega» → ambientes; «dónde veo los logs» → observabilidad; «cómo corro
> el backend en local» y «cómo pruebo sin pegarle al banco» → local; «qué repos hay», «qué microservicios» y
> «qué hace el pre approvals service» → repos. Las tres marcadas por cobertura baja son las que el corpus de
> verdad no tiene o tiene en otro tema (crons, autenticación interna, webhooks).
> **MEDICIÓN · 2026-09-03** — el diccionario en prod: 235 tablas, 13 vecindarios, 178 sin tema.
> `user_requests` sale con `filas_aprox`, 32 columnas, 8 referencias, 58 columnas que la apuntan, sus 2
> modelos y **las 5 áreas que la declaran**, todas con `via: declarada`. `lender_rules` → altas A3; `otps` →
> motai A2 y onboarding A1.
> **MEDICIÓN · 2026-09-03** — `/api/pregunta` con «en qué tabla queda el estado de una solicitud y cómo se
> llama la columna»: **2 pasos, 7,1 s**, respaldada con 2 citas, y contesta exacto (la tabla, que la columna
> no se llama «estado» sino `user_request_status_id`, y el catálogo al que apunta). Las preguntas de este
> tipo tomaban 4 a 9 pasos: buscar alcanzó porque el diccionario reconoce la tabla y el glosario la explica.

**Lo único que sigue fallando, y es honesto:** «dónde está la tabla de solicitudes y sus estados» cae en
motai al primer resultado de PROSA. La respuesta igual llega —la clave `tablas` de la misma respuesta trae
`user_requests` con sus cinco áreas— pero el ranking léxico manda a otro tema porque la pregunta no nombra
ni la tabla ni la columna. Es vocabulario, no mecanismo.

### 2026-09-03 · madrugada · 31 — los DOS monolitos, y la hipótesis de los logs medida (#77, sin PR nuevo)

Miguel: «sigamos trabajando en el PR 77 para no seguir creando PRs. También sería validar contra
legacy-application, no sólo contra legacy-backend, el uso de tablas… y en cuanto a la tabla de logs quizás
ya no se usan porque usamos Loki, puede ser una causa, sigue indagando». Las dos cosas dieron hallazgo.

**1 · La señal que faltaba.** Al barrer los dos repos apareció que el acceso explícito era la señal
equivocada: en Laravel el nombre de la tabla casi nunca se escribe, se escribe el MODELO.

> **MEDICIÓN · 2026-09-03** — barriendo `main` de los dos monolitos: por acceso explícito (`DB::table`, un
> join, `$table`) **33** tablas; **por los modelos que los archivos importan, 171 de 235**. Y por repo:
> backend 150 · application 145 · 124 en las dos · **21 sólo en application** (entre ellas
> `reminder_dispatch_log`, 111.487 filas) · 26 sólo en backend. Miguel tenía razón en los dos frentes.

**2 · El inventario, hecho herramienta.** `-tablas` cierra con las tablas que ningún área declara, partidas
en dos: las que algún archivo usa —un área o un tema que falta, CON el archivo en la mano— y las que nadie
usa, que es otra pregunta. De las 48 sin dueño con volumen, **39 tenían código que las usa**.

**3 · La hipótesis de los logs es FALSA.** Leí la última fila de cada tabla de log por clave primaria en
prod, a las 06:20: **todas escribieron ese día** — `logs` ese mismo minuto, `creditop_x_log` y
`twilio_logs` ocho minutos antes, `qr_logs` y `reports_log` esa madrugada, y las dos de recordatorios el
día anterior a la misma hora (un reloj diario). Loki no reemplazó el log a tabla: **conviven**, y dicen
cosas distintas —Loki la línea de la aplicación con su traza, las tablas el registro de negocio, que
sobrevive a la retención—. Quedó como sección del tema `observabilidad`, con el dato de que a `logs` le
escriben 91 archivos de los dos monolitos.

**4 · Y de indagar eso salió otro hallazgo, más incómodo:** `filas` era `information_schema.table_rows`,
una ESTIMACIÓN. Medido contra `COUNT(*)` en nueve tablas se desvía hasta un **23 %** (`qr_logs` 48.719
estimadas contra 63.443 reales; `lender_rules` 41.285 contra 51.726) y
`user_request_risk_central_verified`, que ayer di por «tabla sin escritor y quizá vacía», tiene **301.690
filas reales** contra 276.696 estimadas: está viva, y sigue sin código que use su modelo. El campo pasó a
llamarse **`filas_aprox`** en el JSON, el struct y la API: el nombre lo dice para que nadie la cite como
exacta, que es la misma regla que la fecha al lado de cada número.

> **MEDICIÓN · 2026-09-03** — 15 declaraciones más desde el inventario (cada una con el archivo que la usa
> como evidencia): **57 de 235 tablas con dueño** (eran 42) y las sin dueño con 1.000+ filas de 48 a **33**.
> Bench 92/115, soporte 117/118, equipo 22/22 y lint (205 secciones): iguales. `-race` 0 · `unused` 0 ·
> humo y dictado todo bien. #77 en verde, 9 commits.

**Detalle que casi arruina el inventario:** `codebase.GrepLineas` recorta a 400 líneas y el barrido necesita
unas 10.000, así que la primera corrida dijo «nadie la usa» de tablas que sí se usan — justo la conclusión
que no se puede errar. El barrido va directo con `Run`.

### 2026-09-03 · madrugada · 30 — «¿para qué Eloquent?»: las tablas se declaran, y el modelo baja a sugerencia (#77)

Miguel, sobre el diseño que yo acababa de subir: «no entiendo para qué Eloquent, o sea, la idea es que al
igual que los archivos tuviéramos la lista de tablas que tocan los flujos específicos, ¿eso no es más
rico?». Tenía razón, y se pudo medir antes de cambiarlo.

> **MEDICIÓN · 2026-09-03** — sobre las 96 áreas, leyendo sus 601 archivos de `origin/main`: por el modelo
> de Eloquent se alcanzaban **27** tablas de 235; por **acceso explícito** en el código declarado (una
> consulta, un join, `$table`), **33** en 29 áreas; por **mención** del nombre, **67** en 61 áreas. El área
> del recorrido del codeudor menciona 16 y por modelo alcanzaba 2. Y al revés: `users` (367k filas) no se
> nombra en el código de ninguna área y su modelo SÍ está declarado. **Ninguna inferencia sola alcanza** —
> por eso se declara, y las inferencias quedan como sugerencia.

**Lo construido:** `Area.Tablas` en el map.json; `TemasDeTabla` prefiere lo declarado y sólo cae al modelo
si nadie la declaró, marcando `via` (`declarada` | `modelo`) porque son dos niveles de certeza, como el hash
y la prosa; el lint exige que cada tabla exista en el esquema y no se repita, y el resumen dice cuántas
quedan sin dueño con volumen; `canon -tablas [tema]` sugiere con las tres señales separadas y ordenadas por
señal y volumen, sin escribir; y el dictado acepta `tablas` en la pieza, validadas al entrar.

**Y su segunda idea —«en base a las tablas faltantes podríamos despejar más información»— dio esto:**

> **MEDICIÓN · 2026-09-03** — 168 tablas que ningún área mencionaba, 42 con 1.000+ filas. Cinco entraron al
> mapa al revisarlas: **`otps`** (522k) la tocan DOS flujos —el celular del titular en onboarding A1 y el
> codeudor en motai A2—, **`lender_rules`** (41k) es la tabla de las reglas que altas A3 ya describía sin
> nombrar, **`users_category_log`** (1,5M) es de creditopx A1 y salía por acceso en `datos`,
> **`user_terms_acepteds`** (573k) es formalizacion A1, y **`user_request_risk_central_user_data`** (1M) es
> la unión solicitud↔buró de datos A4 y kyc A2. Las sin dueño con volumen bajaron de **74 a 48**.

⚠ **Un hallazgo que vale por sí solo:** `user_request_risk_central_verified`, **276.696 filas**, no la
escribe ningún código de `main` — sólo aparece en su migración y en un `.sql`. Quedó sin dueño a propósito.

> **MEDICIÓN · 2026-09-03** — 61 declaraciones en 10 temas · 42 de 235 tablas con dueño · banco del equipo
> **17/18 → 22/22** · bench 92/115, soporte 117/118 y lint (204 secciones) iguales · `-race` 0 · `unused` 0
> · humo y dictado todo bien. `user_requests` sale con las 5 áreas que la declaran, de 5 temas distintos.

**Lo que encontró el arnés y yo no vi:** una pieza que declara tablas pero cuyos archivos ya estaban todos
declarados **no crea área**, y las tablas se perdían en silencio. Ahora la respuesta lo dice
(`tablas_no_aplicadas`) y hay que sumarlas al área que ya los declara. Perder una declaración sin avisar es
peor que pedir un paso más.

**Decisión de diseño que queda:** lo declarado gana a lo inferido, y la diferencia se DICE. El día que todas
las áreas declaren sus tablas, la mitad que cae al modelo deja de aportar y se puede sacar.

### 2026-09-02 · noche · 29 — el diccionario de tablas: el dato entra al hilo (#77)

Miguel: «¿qué tal si hacemos un diccionario de las tablas de la base y cómo se conectan con el corpus? como
hicimos con los nombres de entidades y negocios, pero con las tablas y columnas». Y «arranca».

**Medido antes de opinar** (prod, sólo lectura): **235 tablas · 3.094 columnas · 64 FK declaradas · 14
columnas con comentario**. El corpus nombra tablas 28 veces en toda su prosa (por diseño), y sólo **27 de las
235** se alcanzan desde un modelo que algún mapa declare. El diccionario de nombres ya hace lo mismo para
comercios/entidades/estados (558 entradas, generado, con las consultas adentro). Y la semilla existía en el
playground personal: `workers relaciones` (247 tablas, 432 relaciones con su origen, 13 vecindarios).

**Lo construido (#77, tres commits que compilan solos, sobre la rama de #76 con base `main`):**
- `corpus.Tablas`: carga `content/tablas.json`, reconoce tablas por nombre y columnas con `_` (las mudas
  no) por token exacto; **qué tema cuenta cada tabla se deriva en caliente** cruzando sus modelos con los
  archivos declarados en los mapas (no se guarda: envejecería); una columna la cuentan las tablas donde
  está y la tabla a la que apunta. `/api/search` → clave `tablas`; `/api/tablas` (índice por vecindario,
  `sin_tema`) y `/api/tablas/<nombre>` (columnas, relaciones, modelos, temas); el `buscar` del agente lo
  ve; los bancos lo cuentan como camino.
- `dev/tablas.py`: tres CSV de information_schema + los clones → el JSON. Relaciones 64 fk + 287 por
  convención `<singular>_id`; vecindarios por prefijo portados de `workers/modelo.py`, con herencia.
  258 KB. 158 tablas con modelo en ambos monolitos, 34 en uno, 43 sin modelo.
- Contenido: `datos` declara la espina del backend que faltaba (UserRequest, Allied, AlliedBranch); el
  glosario gana «Solicitud, por dentro: la tabla `user_requests` y su estado»; +4 preguntas con nombres de
  tabla en el banco del equipo.

> **MEDICIÓN · 2026-09-02** — banco del equipo **17/18 → 22/22**. «qué es user_request_status_id»: de «sin
> resultados» a columna en 3 tablas que apunta a `user_request_statuses`, temas datos y bancolombia.
> «cuántas filas tiene user_requests»: 568.841 filas, 8 referencias, 58 columnas la apuntan. Una búsqueda
> con tablas pesa 1,6 KB. Bench 92/115 · soporte 117/118 · lint 204 secciones: iguales. `-race` 0 ·
> `unused` 0 · humo y dictado todo bien.

**Tres cosas que salieron de medir, no de pensar:** el plural de Eloquent falla con «data» (el generador
prueba el singular si el plural no existe); la regex de modelos agarraba `tests/Unit/Models/*Test.php`; y
una columna reconocida no llevaba a ningún tema porque sólo las tablas lo hacían. Y una de método: los
gates corrieron una vez contra un binario viejo (el banco embebido seguía en 18 preguntas) — rebuild antes
de medir, siempre.

**Decisión de diseño:** el tema de una tabla NO se guarda en el JSON. Si se guardara, un `declarar` del
bucle lo dejaría viejo en silencio; derivado de los mapas, cambia cuando cambian ellos.

### 2026-09-02 · noche · 28 — la capa `operar`: canon para el equipo de tecnología, medido antes y después (#76)

Miguel: «quiero que canon no sea sólo soporte sino la documentación para el equipo de tecnología; que
cualquiera pueda usar la API para salir de dudas de cómo funciona CreditOp. ¿Lo ves viable?». Y después:
«arranca y hacé varias pruebas en local antes de darme el PR».

**Medido antes de opinar.** Dieciséis preguntas típicas de un dev por `/api/search` en prod: **4** caían en
una sección que contestaba; **12** devolvían un resultado de otro tema con puntaje alto («cómo se despliega a
producción» → motai, la calculadora de la cuota, score 209). Dos preguntas al agente: honesto («el canon no
describe un proceso de CI/CD»; «no tiene una superficie de logs») pero en **28 y 17 s, con 9 y 5 pasos**.
La causa: el corpus está escrito para «qué pasa y qué se le contesta», por asunto; no tiene capa operativa;
y la prosa tiene **prohibido nombrar comandos, archivos y endpoints** —correcto para negocio, imposible para
un runbook—. La máquina de políticas por capa ya existía (`Policies` por `layer`, con una sola capa).

**Lo construido (#76, dos commits: herramienta y contenido):**
- **La clase `operar`**: política propia (2.500 palabras, 500 por sección, direcciones permitidas),
  `CheckTextFor` por capa (el dictado y el ensayo la aplican según la clase del nodo), lint **un tema, un
  documento** (dos compartirían el mapa y sus anclas serían ambiguas), `-nuevo <tema> operar`, y los tres
  lugares que asumían `tema/context` resuelven la clase que exista.
- **El banco del equipo** (`preguntas-equipo.txt`, `-equipo` en el Dockerfile; informa, no bloquea).
- **`cobertura`** en `/api/search` y en el `buscar` del agente: qué parte de las palabras de la pregunta
  cubre el mejor resultado; la mitad o menos → nota «probablemente el corpus no tiene esto». Etiqueta, no
  filtro: el orden no cambia.
- **Cuatro temas operativos verificados contra `main` hoy**: ambientes (27 workflows: develop/qa/staging/lab
  por rama, **producción por tag**, migraciones manuales, dev+qa+staging comparten la BD, el front de
  staging le habla al backend de develop —misma `VITE_API_URL`—), local (make up/setup, drivers fake,
  **make test y make fresh borran la base: TRES tests con RefreshDatabase, eran dos el 19/8**), repos (qué
  hay, qué microservicios, cuáles no se tocan hace meses), observabilidad (Loki con `app`/`environment` y
  por qué no filtrar por environment; OTel a Tempo con `traceparent` a los proveedores; PostHog salvo local).

> **MEDICIÓN · 2026-09-02** — la misma sonda contra el servidor local con el corpus nuevo: **10/16 al primer
> resultado** (era 4), **12/16 en los dos primeros**; las dos sin cobertura (autenticación interna, webhooks)
> quedan marcadas; una cubierta no se encuentra («la tabla de solicitudes y sus estados» → motai: `datos` no
> dice «tabla»). Bench **igual** (92/115 · 115/115), soporte igual (117/118), `-equipo` 17/18, lint ✓ 19 nodos
> · 203 secciones · 140/186 respaldadas. Tests, `-race` 0, `unused` 0, humo y dictado (fase nueva: abre un
> tema operar por API, dicta un comando que context rechaza con 422, y el corpus pasa el lint) todo bien.

**Dos ajustes que salieron de medir, no de pensar:** el umbral de cobertura era `< 0,5` y las dos preguntas
sin cobertura quedaron justo en 0,5 → pasó a «la mitad o menos». Y `repos` perdía contra `ambientes` porque
sus títulos no decían «qué repos hay» ni «microservicios»: con los títulos en las palabras de la pregunta
pasó a primero. Vocabulario, otra vez, más que buscador.

**Dato nuevo para la regla de seguridad del playground:** en `main` de legacy-backend hay **tres** tests con
`RefreshDatabase`, no dos: se sumó `Modules/Backoffice/Tests/Feature/LenderRulesWriterServiceTest.php`.
El CLAUDE.md personal se corrige en este mismo commit.

### 2026-09-02 · noche · 27 — #75 en prod: la lectura bajó lo medido; el texto en `buscar` NO ahorró el turno

Miguel mergeó y desplegó a las 20:07. Las cuatro llamadas de la tabla, contra prod:

> **MEDICIÓN · 2026-09-02** — búsqueda `solo 6 cuotas rotativo`: **36.896 → 17.583 bytes** (~9,2k → ~4,4k
> tokens), 6 resultados, 6 áreas, 3 temas, objetivo más largo 130 caracteres. Sección de `listado` en JSON:
> **25.370 → 7.758** (1 sección, 2 áreas, 33 archivos, contra 10 áreas y 146). Sección de cartera:
> 6.606 → 3.562. La sección en md y el índice en md, iguales (837 B y 21 KB). Idéntico a lo medido en local.

**Y el resultado negativo, que vale decirlo:** el texto del primer resultado en `buscar` no le ahorró el
turno al agente. Las mismas dos preguntas de la tarde: la del rotativo hizo **4 pasos** (buscar, buscar,
leer, contestar) en 10,4 s contra 3 pasos y 9,9 s antes; la de Motai hizo 4 (buscar, leer sección, leer
el tema ENTERO, contestar) en 21 s contra 5 y 17 s. El modelo lee igual aunque ya tenga el texto, y el
texto en el historial subió la escritura de caché (15,8k y 11,9k contra 9k y 5,7k). Dos corridas no son
una medición del comportamiento del modelo; son la señal de que la palanca no es el payload sino el guion
del agente —qué le dice sobre leer antes de citar— y eso se cambia midiendo con más preguntas, no con dos.
Queda anotado para el PR del agente, no se toca ahora.

**Lo que sí se confirmó:** el camino léxico bajó como se midió en local, con el ranking intacto.

### 2026-09-02 · noche · 26 — consultar barato: la grasa estaba en el camino léxico, y estaba localizada (#75)

Miguel: «ya desplegué, ¿cómo quedó? ¿podemos hacer consultas eficientes?». Primero el deploy de #74,
validado en prod con las cuatro comprobaciones del PR. Después, medir en vez de opinar.

> **MEDICIÓN · 2026-09-02** — `/api/pregunta` en prod, dos preguntas reales: **10 y 17 s**; quien pregunta
> recibe 550–1.100 tokens; del lado de canon 21–27k de prompt con **80–90 % leído de caché** (la lectura
> de caché subió de 12k a 21k entre la primera y la segunda). 3 y 5 pasos: buscar, leer ×1–3, contestar.
> Las dos respaldadas con citas. Razonable: no era ahí.
> **MEDICIÓN · 2026-09-02** — el camino léxico que sigue un agente con `consultar`: skill 1,4k · índice
> 10k (5k en md) · **una búsqueda 9,2k** · leer una sección 3,9k → **~20k tokens por consulta**.

**Una medición falsa que me hizo perder media hora, y que ahora está en el skill:** medí «leer una
sección» con `curl` y la URL llevaba el `#` sin codificar. `curl` trata `#…` como fragmento y NO lo manda,
así que el servidor recibió el tema entero (10 secciones, 5 áreas) y yo concluí «una sección pesa 15 KB y
`format=md` no aplica». Con `%23`: cartera 6,6 KB en JSON, **1,5 KB en md**; listado 25 KB en JSON (el
mapa entero: 10 áreas, 146 archivos) y **837 bytes en md**. Cualquier agente que arme la URL a mano cae
igual y paga diez veces más sin enterarse — por eso va en el skill y en el README.

**Dónde estaba la grasa, medido por campo:** en la búsqueda, `in_the_map` 12,4 KB con el objetivo de cada
área **dos veces** (`section_title` y `fragment`) y dos objetivos de **1.745 y 1.681 caracteres**;
`nodes_hit` 5,8 KB listando todas las anclas de seis temas; el glosario 3,9 KB con sus vecinos. En el
read de una sección: el mapa entero del tema.

**Lo construido (#75, tres commits que compilan solos):**
- **Read de sección = la sección + sólo las áreas que la respaldan** (el hilo del paso 2), con sus repos;
  sin respaldo lo dice. Listado: **25,4 KB → 7,8 KB**.
- **Search magro**: objetivo una vez y acotado a 240, `citar` armado, `code` para lo entero; `nodes_hit`
  tres temas × ocho anclas; glosario sin vecinos; **seis resultados por defecto** (el banco mide los tres
  primeros; el `hint` dice cuántos más). **36,9 KB → 17,6 KB**. Bench igual: 92/115 · 115/115 · 115/115.
- **El agente que contesta recibe el texto del primer resultado**: las dos preguntas del día hicieron
  `buscar` y después `leer` justo ese resultado — un turno del modelo para pedir lo que ya tenía. `buscar`
  pasó a función (`herramientaBuscar`) para probar sin modelo qué recibe. Se mide en prod tras el merge.
- **Los dos objetivos kilométricos** eran el hallazgo entero de un redactor pegado como objetivo por un
  `declarar` del bucle (2026-09-01). Reescritos leyendo el código: FirstSurname.php (el primer apellido
  con sus partículas y el tope de 16 de Experian) y routes.ts (el router del asistente). 220 y 177
  caracteres. Queda para el bucle que `declarar` escriba objetivos cortos desde el origen.
- El skill `consultar` (892/900 palabras) enseña índice en md, sección en md y el `%23`.

> **MEDICIÓN · 2026-09-02** — una consulta típica de un agente baja de **~24k a ~11k tokens** (skill 1,4k
> + índice md 5,3k + búsqueda 4,4k + sección md 0,2k). Tests sobre el corpus real: la sección pesa menos
> de la mitad del tema y trae sólo sus áreas · sin respaldo lo dice · la búsqueda no repite, acota y cabe
> en 20 KB · el agente recibe el texto. `-race` 0 · `unused` 0 · `-lint` ✓ · humo y dictado todo bien.

**Lo que no llegó al objetivo:** dije «de 20k a 5k» y quedó en 11k. Lo que resta son el skill (1,4k, ya
en el techo de 900 palabras) y el índice en md (5,3k, que se lee una vez por sesión). Bajar más es
cambiar el protocolo, no el payload: dejarlo para cuando se mida cuántas veces un agente relee el índice.

> **DECISIÓN · 2026-09-02** — la búsqueda por HTTP devuelve **6** resultados por defecto (era 10). La Sala
> pide 50 explícito, `/api/pregunta` usa 8 y el banco mide los 3 primeros: sólo cambia para agentes
> externos, y el `hint` les dice cuántos más hay.

### 2026-09-02 · tarde-noche · 25 — la API de escritura para el equipo: el mensaje mentía, y el código de un PR abierto no se podía declarar (#74)

Miguel compartió `/api` con el equipo y volvió con esto: «le dice que si va a subir algo va a quedar en
memoria, que no se ingresa al contexto». La pregunta era si `/api` tenía lógica vieja. **Medido contra prod,
paso por paso, como lo haría alguien con la llave** (abrí borradores de prueba y los borré: «nada llegó al
corpus»): el mecanismo estaba al día —el dictado prendido, escribiendo rama + PR— y el MENSAJE mentía en
cuatro lugares. Con llave, el paso 6 de `how_to_use` mandaba a `/api/propose` «con `apply` lo escribe» (da
410 hace días, y su doctrina dice «NO escribe nada, deliberadamente NO persiste»). Sin llave, el catálogo no
decía que escribir existiera (11 filas, todas de lectura; decisión del 2026-08-28 de omitir la escritura a
quien no puede). El paso 5 no nombraba `dictar` y `contextualizar` describía editar dos archivos a mano. Y la
nota del borrador —«el borrador vive en memoria: si el servicio se reinicia, se dicta de nuevo»— era cierta y
no decía qué pasa al cerrar. Juntas producen exactamente la frase que le dijeron.

**La segunda pregunta fue la que abrió el trabajo grande:** «¿y si es contexto que aún no llega a main?».
Medido: declarar un archivo que sólo existe en una rama daba **422 «¿la ruta está bien escrita?»** — la
pregunta equivocada. Y un dato que decide el diseño:

> **MEDICIÓN · 2026-09-02** — de los **17 colaboradores** del repo compartido, **10 sólo tienen lectura**
> (no pueden crear una rama ahí); con escritura, los 5 admins más Miguel y Duncan. Así que «editá el archivo
> y abrí un PR» no es opción para la mayoría: el dictado, que firma la App de GitHub, es el único camino.
> Además el repo tiene `delete_branch_on_merge=false`, y `canon` no aparece en el `CLAUDE.md` ni en ningún
> lugar del repo compartido que un agente lea.

Y un choque con lo de ayer: si alguien declarara a mano un archivo pendiente de merge, **el `retirar` del
paso 3 lo sacaría solo** (lo que main no tiene, se va). El contexto pendiente y el retiro se peleaban.

**Lo construido (#74, un solo PR):**
- **Los textos dicen la verdad**: el paso 6 con llave es el borrador, «el ÚNICO que escribe», y `propose`
  queda como ensayo; sin llave, una línea dice que la puerta existe y cómo pedirla (cambia la decisión del
  28/8: se omiten las herramientas que darían 403, no la puerta — Miguel puede vetarlo); `dictar` en el paso
  5; la nota del borrador dice que vive en memoria SÓLO hasta cerrar; `contextualizar` empieza por la API;
  y `/api` trae **`para_tu_agente`**: tres líneas para el CLAUDE.md de cada dev, servidas desde el server.
- **Declarar desde un PR abierto.** La pieza acepta `pr` (URL, `owner/repo#N` o `#N`); la ruta ausente de
  main se declara desde la rama del PR con **el hash del blob que tiene ahí** —el blob es del contenido, así
  que si mergea igual queda al día sola— y el área la anota en **`pendientes`**. La ronda la cuenta como
  `esperando` (no es deriva, no rompe el «al día», no entra al plan) mientras el PR siga abierto; cerrado sin
  mergear vuelve a ser «no está en main»; ya en main se lista en `pendientes_ya_en_main`. La guardia
  compartida `archivosQueNoExisten` respeta lo pendiente y ante la duda espera y avisa. La marca se va con la
  subida del hash (si no vino del mismo PR) o con el retiro. Lint: lo pendiente está también en `fuentes`
  y el PR tiene la forma `owner/repo#N`.
- **Llaves por persona**, opcionales (`CANON_WRITE_KEYS`): el nombre queda como `quien`, se revoca de a una.

> **MEDICIÓN · 2026-09-02** — tests nuevos: la ronda ×4 (espera · PR cerrado · no se pudo mirar · ya en
> main), el parseo del PR, la limpieza de la marca, el sellado, el lint, las llaves. `dev/dictado.py` con
> **15 comprobaciones nuevas** —incluida la ronda POR CONSOLA contra el corpus con el área pendiente: espera
> el PR, no lo lista como «no está en main», y al cerrarlo sin mergear lo vuelve a listar—: todo bien.
> `humo.py` todo bien · `-race` 0 · `unused` 0 · `-lint` ✓ · bench 92/115 y soporte 117/118 iguales.
> +861/−41 en 21 archivos. CI de #74 en verde.

**Dos cosas del método:**
- El arnés me mintió una vez a favor mío: la ronda por consola «no veía» el área pendiente porque copié sólo
  `onboarding/` al `content/` de prueba y el cargador, al no encontrar el corpus entero, cayó al embebido
  (que no tiene el área). Copiar el corpus entero lo arregló. Un cargador que degrada en silencio es el mismo
  patrón del `E2E_TARGET` por defecto: hay que saber contra qué se está midiendo.
- Intenté partir el trabajo en tres commits por pieza aplicando hunks con `--unidiff-zero` sobre los
  archivos que las tres tocan (`server.go`, `draft.go`): **desplazó líneas y dejó tres commits que no
  compilaban**. Lo tiré (`reset --mixed` conservando el árbol de trabajo, que era el probado) y quedó UN
  commit cuyo mensaje cuenta las tres piezas. Cuando las piezas comparten archivos, partir por hunks no vale
  el riesgo: mejor un commit honesto que tres rotos.

**Lo que se decidió con Miguel:** la API para desarrolladores primero; lo del bucle de agentes (el punto
ciego del expediente, la rama después del merge, el paso 5) para después.

### 2026-09-02 · noche · 24 — el PR del bucle quedó en conflicto por el archivo que #72 borró (#73)

Lo predijo el propio paso 4 y pasó a la primera. El bucle corrió a las 16:25–16:33 —entre que abrí #72 y
que Miguel lo mergeó— todavía con el código viejo: releyó 9 áreas (`sigue`, hashes subidos en 7 mapas) y
guardó `.vuelta.json` en `canon/contexto`, la rama que `main` acababa de dejar sin ese archivo. GitHub
marcó **#73 CONFLICTING** con un solo archivo en conflicto: `tools/canon/.vuelta.json`.

**El arreglo, y por qué no fue cerrar el PR:** traer `main` a la rama del bucle y sacar el archivo de ahí
(`git rm`), en vez de descartar la vuelta. Lo que Sonnet ya releyó vale ~4k tokens y no hay razón para
volver a pagarlo. Quedó un merge limpio y **#73 con exactamente los 7 mapas: +19/−19, nada más**. Verde y
CLEAN (`revisar` 1m30s + CodeBuild); el corpus resultante pasa `-lint`.

> **MEDICIÓN · 2026-09-02** — prod después del deploy de #72: `/health` ok · `/api/tools` ya no anuncia
> `-temas` · `analizar` 0 tokens repartió **10 tareas en 8 temas** · y **nació la rama `canon/estado`**,
> que es la prueba de que el código nuevo está corriendo. `.vuelta.json` se fue de `main`.

**Y la causa raíz ya no puede repetirse:** el estado se escribe en `canon/estado`, así que `canon/contexto`
no volverá a cargar el archivo. Borrar la rama pasó de arreglo a higiene: sirve para que la próxima vuelta
nazca desde `main` limpio, no para evitar un daño. Las otras cinco ramas `canon/*` están todas contenidas
en `main` —incluida `kyc-declara-tusdatos-backend`, cuyos 2 commits entraron por otra rama, verificado por
patch-id— así que son borrables. El repo tiene `delete_branch_on_merge=false`: encenderlo evita la próxima.

⚠ **Lo aprendido, que es de proceso y no de código:** un PR que borra un archivo que OTRO productor
sigue escribiendo deja al productor en conflicto, y el productor acá es un bot que no sabe resolverlo. La
ventana fue de ocho minutos. Cuando el cambio saca de circulación algo que una rama viva produce, hay que
mirar si esa rama tiene trabajo en vuelo ANTES de mergear, no después.

### 2026-09-02 · tarde · 23 — paso 4: ADELGAZAR la herramienta, y de ahora en más UN PR por pieza (#72)

*(Las horas que citan las entradas 20–22 —19:40, 20:05— son UTC, tal como las imprime `gh`: fueron las
14:40 y 15:05 de Bogotá. Todo eso fue la tarde, no la noche.)*

Miguel, después de once PRs en un día: «estamos sube y sube PRs pero no encuentro el porqué… tratemos
de hacer todo en un solo PR». Cambió la forma de entregar, no el trabajo: una rama desde `main`, cinco
commits (uno por pieza), los dos arneses enteros ANTES de abrir, y un solo PR cuyo cuerpo cuenta la forma
completa. El primer intento de commitear falló por una tontería de shell (un comando guardado en una
variable de zsh) y dejó la rama pusheada vacía; el segundo dejó los cinco commits limpios.

**Lo que se fue:**
- **README 16.234 → 2.667 palabras.** Era el 66 % del corpus que documenta, con un bloque entero
  duplicado y afirmaciones en presente que ya no lo eran (el dictado «arranca apagado», el corpus «es
  plano», `-temas`). El de hoy es la puerta: qué es, cómo se corre, leer, escribir, el bucle, la CLI, las
  guardias, la arquitectura, las variables, los límites. La historia va a **`docs/HISTORIA.md`**, sin el
  duplicado y con un preámbulo que dice qué caducó.
- **`.vuelta.json` fuera de los PRs y del repo.** El estado de la vuelta se guardaba en la rama del corpus,
  y como el PR del bucle ES esa rama, viajaba dentro de cada PR (#68 traía doce commits «la vuelta en
  curso») y terminó en `main` pese al `.gitignore`. Ahora va a **`canon/estado`**, que nunca se revisa ni
  se mergea; `cargarPlan` lee de ahí y perdió la comprobación de «¿es el que se mergeó?». Salió de `main`
  con `git rm`.
- **`verificado_contra`** de los 14 mapas y del scaffold: nadie lo leía y decía «2026-08-28» para siempre.
- **`-temas` + `LocalLag`**: segunda copia de la comparación de hashes; `-ronda <clones>` contesta lo mismo
  con la sonda única. El skill de recontextualizar apunta a `-ronda`.
- **La guarda de modelo en analizar**: analizar es determinista desde #48; la guarda era de cuando agrupar
  costaba 196k. Una instancia sin llave de modelo no podía ni repartir el residuo, que es gratis. Lo
  encontró `dictado.py`, que corre sin modelo a propósito.

> **MEDICIÓN · 2026-09-02** — Go: **−188 líneas netas**, además del README. `go vet` · `unused` 0 ·
> `-race` 0 fallos · `-lint` ✓ 15 nodos, 128/169 con área detrás · `-bench` 92/115. `humo.py` todo bien.
> `dictado.py` todo bien, con la fase nueva: analizar guarda la vuelta en **`canon/estado`** y ningún commit
> del corpus arrastra `.vuelta.json`. CI de #72 en verde (`revisar` 1m36s).

**El enlace «mal hecho» de la corrida 20 NO estaba mal.** Rastreé el `no alcanza` del autocompletado
(«1.500.000 con ocupación Empleado»): el código vive en `OnboardingController.php` (líneas 866 y 1361,
autofill para 209–211), que el área A3 de onboarding **ya declara** — pero **no cambió**, así que no viajó
en el expediente, que lleva sólo lo que cambió. El redactor no podía verlo y dijo la verdad. Es un límite
del diseño (quedó escrito en el README, §Límites), no del enlace. La guarda del mapa me frenó a tiempo
antes de declarar dos servicios de identidad (Mareigua/Agildata) que guardan el salario REAL, no el
default: declarar a ciegas es justo lo que no se hace.

> **DECISIÓN · 2026-09-02 · Miguel** — **un PR por pieza de trabajo, no por cambio.** Una rama desde `main`,
> commits por concern (local), arneses (`humo.py`, `dictado.py`, gates) y UN PR al final. El avance se
> cuenta en el chat y acá, no con PRs. Convive con «base = `main` siempre»: un PR con muchos commits no es
> un PR apilado. Excepción dicha de antemano: herramienta y prosa del corpus son dos piezas distintas y se
> revisan distinto — pueden ir en dos PRs.

**Lo que queda al mergear #72:** borrar `origin/canon/contexto` (mergeada en #68, todavía con `.vuelta.json`
adentro). Si el bucle sigue commiteando ahí, el próximo PR del corpus lo devuelve a `main`. Se pide antes
de borrar. Las otras cinco ramas `canon/*` remotas son ensayos viejos del dictado; se miran aparte.

### 2026-09-02 · noche · 22 — EL CICLO CERRÓ COMPLETO: el mapa soltó la ruta muerta (#71)

Cuarta corrida de onboarding, con #70 desplegado. **Funcionó.**

> **MEDICIÓN · 2026-09-02** — corrida `c6`: 3 tareas, **4.288 tokens**, cero caídas. Veredictos: 1
> `sigue` · 2 `no alcanza` · 2 `ya no`. Dos pasos `integrador·retira`: «retiró del mapa lo que ya no
> está en main en 1 área(s) — sin releer nada: eso lo dice el árbol». Y en la rama del bucle:
> **`kyc-pending-routing.ts` ya no está declarado por ninguna área**; las dos quedaron con su archivo
> vivo (`kyc-pipeline.server.ts`) y conservaron sus `secciones`.

**El ciclo completo, por primera vez:** merge en los repos → ronda → analizar (0 tokens) → redactor por
tema (una llamada) → prosa corregida + hash subido + **ruta muerta retirada** + archivo nuevo declarado
→ un PR que revisa una persona. `Creditop-SAS/playground#68`, 22 commits.

⚠ **Y el diff del mapa dejó un hueco nuevo a la vista:** las dos áreas que nacieron de los `declarar`
—las que declaran `route-helpers.ts`, donde se mudó la lógica— **no declaraban ninguna sección**. Cada
`declarar` del bucle creaba código vigilado sin decir qué prosa sostiene: el agujero del paso 2
reabriéndose de a poco. Arreglado en #71, con la guarda que importa: **el ancla se comprueba antes de
escribir**, porque el nombre lo escribe el redactor y una pieza que sólo declara no pasa por el lint —
un ancla inventada habría pasado el cierre y reventado el build. Si no coincide, el área nace sin
enlace: perder el hilo de un área es barato, dejar `main` en rojo no.

> **MEDICIÓN · 2026-09-02** — `dev/dictado.py` prueba los dos casos a la vez (sección real e inventada):
> de las dos áreas declaradas, una lleva su enlace y la otra no, y el corpus resultante pasa `-lint`.

**Detalle del arnés que me hizo dudar:** `reg.cerrar` intermedio ya marca la corrida como cerrada, así
que sondear por `cerrada` sale antes de que corran los integradores. La corrida seguía trabajando y yo
la leí a medias. Para leer una vuelta completa hay que esperar el `resultado` que dice «N tarea(s), M con
cambio propuesto», no el `cerrada`.

### 2026-09-02 · noche · 21 — el `declarar` no cerraba el área: el retiro va con CUALQUIER veredicto (#70)

#69 mergeado (20:05) y desplegado (20:09). Tercera corrida de onboarding: **los integradores ya no se
caen** —28 s, 1.279 tokens— y el retiro **tampoco corrió**. Esta vez no fue un bug: fue un hueco de
diseño que sólo se ve con el caso real delante.

**El redactor cambió de veredicto, y tenía razón.** Con la prosa ya corregida en #66, las dos secciones
de KYC dejaron de ser un `ya no`: son un **`declarar`** — al mapa le falta el archivo donde se mudó la
lógica. El integrador declaró `kyc-pipeline.server.ts` mecánicamente. Pero `declarar` **no cierra el
área** (sólo `sigue` y `ya no` lo hacían), así que la ruta muerta siguió declarada. Y es el caso MÁS
común: la lógica se mudó, el viejo murió, el redactor nombra el nuevo, el viejo queda.

> **MEDICIÓN · 2026-09-02** — corrida `c4`: 3 tareas, **28 s, 1.279 tokens**. Veredictos: 1 `sigue` ·
> 2 `declarar` (los dos citando `b3eb24f6`). Dos `integrador·mapa` declararon 1 archivo cada uno, sin
> modelo. PR #68 con 11 commits. Cero caídas.

**El arreglo es una regla en vez de tres:** el área se cierra con **cualquier** veredicto. Retirar no
opina sobre la prosa —que el archivo no exista lo dice el árbol— así que un `declarar` o un `no alcanza`
alcanzan igual que un `sigue`. Y un `no alcanza` con archivos muertos dejó de ser «nada accionable».

**Y la distinción que hay que no perder:** un retiro sin nada que releer NO sube ningún hash. La pieza,
el título del commit y el paso se llaman por lo que hicieron (`integrador·retira`), porque decir
«releído» ahí sería justo el nivel 2 del guion disfrazado de nivel 1.

> **MEDICIÓN · 2026-09-02** — `dev/dictado.py` gana el caso del retiro SOLO y pasa. Se corrigió una
> aserción mía que exigía «subió hashes y retiró» donde el archivo vivo del área ya estaba al día: el
> código tenía razón y la prueba estaba mal.

**Lo aprendido en tres corridas seguidas contra prod:** el bucle no falló ninguna de las tres veces por
lo mismo, y ninguna de las tres se veía en local. La primera fue una expectativa mía (el residuo no baja
sin merge), la segunda un bug latente de estado compartido que retirar hizo salir, y la tercera un hueco
de diseño que sólo aparece cuando el veredicto cambia porque la prosa ya se arregló. **Correr contra prod
después de cada merge no es opcional.**

### 2026-09-02 · noche · 20 — el retiro NO llegó a correr, y el bug era de estado compartido (#69)

#67 mergeado (19:40) y desplegado (19:45). Corrí onboarding esperando el residuo en cero. **No.**

**Primero, una expectativa mía mal puesta:** el residuo NO puede bajar con la corrida. El bucle escribe
en la rama `canon/contexto` y su PR; prod compara contra el corpus del build desplegado. El residuo baja
cuando el PR mergea y se despliega, no cuando la vuelta corre. Obvio dicho así, y lo dije mal antes.

**Y después el bug de verdad.** Los dos integradores de prosa de KYC **agotaron sus 6 turnos** (2,3k
tokens cada uno) llamando `cerrar` cuatro veces contra el mismo error: «no encontré employment-info.tsx
con su hash actual en el mapa: no lo toco a ciegas». La prosa aceptada nunca llegó al PR, y como el
retiro corre DESPUÉS del arreglo de prosa, tampoco corrió.

> **MEDICIÓN · 2026-09-02** — corrida `c2`: 3 tareas, 110 s, **6.830 tokens**. Veredictos: 3 `sigue`
> (uno cerró su área) · 2 `ya no` (los dos citando el commit `b3eb24f6`) · 1 `no alcanza`. Dos
> integradores caídos por agotamiento. PR #68 con 6 commits.

**La causa: estado de un borrador guardado fuera del borrador.** `subidas` y `retiros` eran dos `var` de
paquete indexadas por nodo y **nadie las limpiaba**: el `sigue` cerró un área dejando ahí sus hashes
viejos, y el integrador siguiente intentó aplicarlos sobre un mapa que ya los tenía nuevos. El splice se
negó con razón. Era latente de antes del paso 3 —`subidas` nunca se limpió— y sólo salía cuando un
cierre de área precedía a un cierre de prosa sobre el mismo tema en el mismo proceso; **retirar hizo esa
secuencia normal**. Ahora viven en el struct `borrador`.

**Y una lección de diseño que vale más que el bug:** un rechazo que el agente **no puede arreglar** no es
un rechazo, es una falla. `cerrar` devolvía el error del servidor con la misma forma que el del lint, así
que el integrador hacía lo único razonable: reintentar. Ahora el 4xx es suyo y el 5xx corta la corrida y
se propaga como lo que es.

> **MEDICIÓN · 2026-09-02** — `dev/dictado.py` gana la fase que lo reproduce (dos borradores seguidos
> sobre el mismo tema, el segundo con prosa sin archivos) y pasa. Hacen falta DOS cierres para verlo:
> ningún test unitario lo iba a agarrar. `-race` 0, `unused` 0, bench 92/115, humo verde.

**Lo que la corrida dejó dicho y no es código:** un `no alcanza` avisó que la sección del autocompletado
está enlazada a un área cuyos archivos no tienen esa lógica — **uno de mis 158 enlaces a mano está mal**.
Es exactamente la corrección por uso que el paso 2 predijo. Pendiente, chico.

### 2026-09-02 · noche · 19 — paso 3: el mapa ya puede ENCOGER (#67)

El agujero que la evaluación encontró y que la corrida 18 cuantificó. Cerrar un área son DOS cosas y
ahora hace las dos: **sube el hash** de lo que sigue vivo y **retira** lo que ya no está en main.

**Lo que decidió el diseño:** entra por la puerta que YA existía (`operacion: "verificado"`), así que no
hay camino nuevo ni forma de retirar sin un veredicto detrás. Tres guardas y **ninguna de juicio**: la
ruta tiene que estar declarada · NO tiene que existir en main (lo dice el árbol) · viaja con el veredicto
que revisó su prosa. La pieza clave fue partir `resolverArchivos`: «no existe en main» dejó de ser un
`problema` genérico y pasó a ser un dato que **cada puerta interpreta** — para declarar es fatal, para
cerrar un área es justamente el caso a atender.

**Y si el retiro vacía el área, el área se va.** Un área hueca es prosa sin respaldo disfrazada de mapa.
La sección pasa a contarse sin respaldo (gris en la Sala) y el retiro se dice en el cuerpo del PR y en el
paso de la corrida.

> **MEDICIÓN · 2026-09-02** — el retiro REAL de punta a punta (`dev/dictado.py`, 0 tokens) contra el
> corpus de verdad: la ruta muerta se va · el área sobrevive con su archivo vivo (declaraba 2, uno
> seguía vivo) · conserva sus secciones · **no se llevó ninguna otra área (10 de 10)** · el corpus sigue
> pasando `-lint`. Más 4 tests del splice: una ruta de varias, el área que queda vacía, retirar todo, y
> un hash que no coincide (no toca nada). `-race` 0 fallos, `unused` 0, bench 92/115, humo verde.

**Encontrado escribiéndolo:** el bucle que limpiaba repos vacíos **cortaba** en la primera `"fuentes": {}`
en vez de saltearla, así que al retirar tres rutas de una vez dejaba sin limpiar las áreas siguientes. Lo
cazó el test de «retirar todo» — y es exactamente la razón por la que el splice de texto se comprueba
parseando el resultado antes de devolverlo.

**Dato del dominio que salió al mirar el caso real:** las dos áreas de onboarding declaran DOS archivos
cada una (`kyc-pending-routing.ts`, borrado, y `kyc-pipeline.server.ts`, vivo), así que el retiro las deja
en pie y su prosa sigue respaldada. El caso «el área se queda vacía» no se dio en el corpus real — está
cubierto por test.

**Higiene:** `resolverArchivos` devolvía su lista nueva con el mismo nombre que un `faltan []string` de la
misma función (compilaba por el bloque, pero es una trampa) → `sinRastro`. Y `skills/vigilar.md` se pasó
del techo de 900 palabras y el lint lo bloqueó: se recortó lo que ya dice `arnes.md`.

### 2026-09-02 · tarde · 18 — onboarding en prod CON el hilo: de `no alcanza` a `ya no`, 4.875 tokens (#66)

#64 mergeado (14:48) y desplegado (14:52); prod sirve el enlace: **128 secciones respaldadas**. Y la
pregunta de Miguel —«¿sigue funcionando para que alguien con el token de escritura pueda agregar
contexto?»— disparó el cierre del paso 2 (#65).

**La corrida que estaba prometida.** Residuo 31 (entró mucho trabajo hoy: altas, creditopx, listado,
motai, onboarding). El plan: 15 tareas, 5 de onboarding, **todas con las secciones que respaldan**
excepto `p721545` (el área de «confirmación de cupo», una de las 5 que no respaldan prosa).

> **MEDICIÓN · 2026-09-02** — `POST /api/tareas/onboarding`: **88 s · 4.875 tokens pagados** (+68k
> escritos en caché, 67k leídos) para 5 áreas y 2 integradores. Expediente: 48k de material, un turno.
> Veredictos: **3 `sigue` · 2 `ya no`** — contra **2 `no alcanza`** en la corrida de la mañana sobre las
> mismas dos preguntas. El `ya no` cita el commit por nombre: «kyc-pending-routing.ts ya no existe en
> main: fue borrado en el commit b3eb24f6 (dejar de usar CPS…), tras un vaivén de reverts». Los
> hermanos del commit hicieron exactamente lo que se esperaba de ellos.
> Los dos integradores escribieron y quedó **`Creditop-SAS/playground#66`** (12 commits): la sección de
> KYC reescrita, con el vaivén explicado en lenguaje de mecanismo y sin nombrar archivos. Un `sigue`
> cerró su área.

**Y el paso 3 quedó justificado con número, no con opinión.** Los dos integradores dejaron dicho:
«no se pudo cerrar [kyc-pending-routing.ts]: archivos que no se pudieron declarar» y **«la prosa se
propuso pero el área queda derivada: no quedó ningún hash por subir»**. O sea: la prosa se arregló y el
área sigue derivada porque su único archivo declarado no existe. **Esas 2 entradas del residuo son
eternas hasta que exista `retirar`.**

> **MEDICIÓN · 2026-09-02** — el camino de ESCRITURA, probado de punta a punta con los falsos y 0 tokens
> (`dev/dictado.py`): sin llave 403 · abrir · pieza con prosa y archivos · cerrar → rama, commit y PR ·
> el paquete con `.md` + `map.json` · **el área nueva declara la sección que respalda** · y el corpus
> resultante pasa `-lint` (183 secciones), que es la prueba de que el ancla que escribe el dictado es la
> misma que produce el parser. `TestSpliceConservaLoQueYaHabiaYNoRompeElJSON` cubre el riesgo del
> arreglo ANIDADO en `areas`. En #65.

**Anotaciones de la corrida:**
- ⚠ `tools/canon/.vuelta.json` viaja dentro del PR #66: el estado de trabajo del bucle entrando a main.
  Es de antes del paso 2 (`guardarVuelta` publica en la misma rama) pero ensucia todos los PRs de la
  vuelta. Candidato a arreglar en el paso 4.
- El lint rechazó la prosa del propio ensayo del dictado por nombrar un archivo, con el motivo exacto.
- Casi reporto una prosa rota: era mi `grep` comiéndose las viñetas del diff. El texto está bien.

### 2026-09-02 · tarde · 17 — paso 2: el hilo entre la prosa y el mapa (#64)

Miguel: «dale arranca y de paso que el grafo de sala se vea con esas conexiones si consideras que vale la
pena». Se hizo el enlace y sí valió la pena en la Sala, pero no como aristas: como COLOR.

**El modelo.** `secciones` en cada área del `map.json`, por ancla; el lint exige que existan (`enlaces.go`,
`policy.go`). `corpus.RespaldoDe(n)` deriva qué secciones tienen área detrás. Es la mitad que faltaba del
hilo: archivos → objetivo → párrafos.

**El llenado, a mano.** `canon -enlazar [tema]` sugiere por vocabulario (objetivo + se_deduce + nombres de
archivo partidos, ponderado por rareza dentro del tema) y una persona decide. Decidí los 13 temas leyendo
los 85 objetivos contra los 169 títulos con la sugerencia al lado: **158 enlaces**. Dejé sin respaldo a
propósito lo que es negocio o meta («De quién es la plata», «Por qué hay dos sistemas», «El corpus no
mapea todo el sistema», «Operar fuera de Colombia abre su propio tema»…).

> **MEDICIÓN · 2026-09-02** — **128 de 169 secciones con un área detrás** · 14 sin respaldo en temas con
> código (arquitectura 6, bancolombia 2, cartera 2, motai 2, creditopx 1, formalizacion 1) · 27 en temas
> sin código (vocabulario 26, internacionalizacion 1). Cinco áreas no respaldan ninguna sección
> (credifamilia A2 plan de cuotas, datos A4 reporte del buró, listado A4 cálculo y A7 reglas del navegador,
> onboarding A5 confirmación de cupo): código declarado del que la prosa no dice nada.

**Lo que fluye del enlace:** la tarea y la tarjeta llevan las secciones («Las secciones que respalda» en
la página de la tarea, verificado en local); el redactor las recibe en el enunciado y el guion le dice que
las relea primero; `/api/grafo` lleva `respaldadas`/`sin_respaldo`/`respaldo`; la Sala pinta GRIS la
sección sin área y el panel dice quién la respalda o que nadie («Sin código declarado detrás: … Puede
ser prosa de negocio — o un enlace que falta», verificado en el navegador sobre creditopx).

**Y el borrado, que era la deuda de la corrida 16.** El expediente de un archivo que ya no está trae los
archivos que tocó el commit que lo borró, marcando cuáles ya declara el mapa (`ArchivosDeCommit` por la
API; el GitHub falso sirve `commits?path=` y `commits/{sha}` desde el clon). Con el dump
(`CANON_EXPEDIENTE_DUMP=1`) se ve lo que recibe el redactor: `b3eb24f6` tocó `kyc-processing.tsx`,
`kyc-pipeline.server.ts`, `otp-verification.tsx`, `routes.ts` (declarados) y `kyc-status.tsx`,
`route-helpers.ts`, `init-loan-request.tsx` (sin declarar). Ahí está la respuesta que en prod no tenía.

> **MEDICIÓN · 2026-09-02** — humo.py, todo bien, con dos chequeos nuevos (el expediente del borrado trae
> los hermanos; dice «ya no existe en main»). Tests `-race` 0 fallos; `unused` 0; lint/bench/soporte
> iguales. `Creditop-SAS/playground#64`.

Detalles que cayeron de paso: `seccion` omitido llegaba como `<nil>` (`texto()`); `/api/grafo` contaba
la introducción como sección («11 de 12»); humo comparaba `content/` contra el índice y fallaba con
trabajo sin commitear (ahora contra su estado previo).

**Lo aprendido:** los enlaces son una afirmación de una persona, como los hashes. Se van a corregir con el
uso —un `ya no` sobre una sección que el área no nombraba es la señal para sumarla— y por eso el lint
informa el respaldo pero no lo bloquea.

### 2026-09-02 · tarde · 16 — onboarding en prod por la puerta nueva: 822 tokens, 16 s, y el límite del expediente con un archivo borrado

#63 mergeado y desplegado (14:10→14:14; `/api/relations` → 404 a los 15 s). El plan de la mañana volvió
solo desde `canon/contexto` (2 tareas). `POST /api/tareas/onboarding` → 202, 2 tareas, **una llamada**.

> **MEDICIÓN · 2026-09-02** — corrida `c1`: **16 s · 822 tokens pagados** (+7.9k escritos en caché) para las
> dos áreas; expediente ~3k. Contra 150k por tarea de la forma vieja. Los pasos «armando y leyendo» de
> cada tarea aparecen ANTES del expediente (#62), cada hallazgo trae `afirma`, y ningún 409 de bloqueo (#63).

**Veredictos: `no alcanza` × 2**, y con razón. El redactor dice, literal: «el archivo declarado ya no
existe en main… no tengo el archivo actual ni su diff completo para confirmar si la lógica de
start/resume sigue existiendo en otro archivo». Con la prosa + los commits + el aviso de borrado no puede
decidir si la lógica se MUDÓ o desapareció. Es la respuesta honesta, y marca el límite exacto del
expediente actual: **para un archivo borrado hace falta ver los otros archivos que tocó el commit que lo
borró** (`b3eb24f6 feat(wizard): dejar de usar CPS…`) — que es la lista «candidatos a SUMAR» del dossier.
Eso es el paso 2, y ahora tiene una medición que lo justifica.

Detalle: `seccion` omitido por el modelo llega a la tarjeta como `<nil>` (`fmt.Sprint(nil)`). Va en el PR
del paso 2.

El residuo de prod subió de 2 a **5**: entró trabajo nuevo a los repos hoy. El bucle lo verá con
`analizar`, gratis.

### 2026-09-02 · mediodía · 15 — validar la poda en prod: el deploy anda, y el único residuo no se podía correr (#63)

#59 y #62 mergeados (13:40 y 13:47), los dos deploys en verde, prod sirve `main`. Lo determinista, bien:
`/health` ok · `/api/tools` ya no anuncia `relations`/`policy` y las filas del bucle dicen «sin modelo» y
«uno por tema» · residuo **2 = el archivo borrado `kyc-pending-routing.ts` en dos áreas de onboarding**
(exactamente lo esperado tras igualar) · bandeja vacía · sin PR abierto. `analizar` en prod: 0 tokens,
2 tareas.

**Y al correr onboarding por la puerta nueva: 409 «este tema no se puede levantar todavía».** Tres cosas:
- `bloqueo` comparaba «faltan» contra el RESIDUO (2 de 2 borrados) y no contra lo DECLARADO (38): un
  tema maduro con un archivo borrado quedaba bloqueado con el motivo equivocado. Un borrado es la señal
  más fuerte de `ya no`; es justo cuando el redactor tiene que correr.
- `/api/relations` en prod devolvía el `index.html` con **200**: el fallback del front se tragaba toda
  `/api/` inexistente. Ahora 404 en JSON, en el contrato.
- La ronda con clones tiraba los borrados como «repo ilegible» (`git rev-parse origin/main:.` falla
  SIEMPRE), y la lógica estaba **copiada tres veces** (CLI, servidor, `-pesar`): arreglé la del CLI y
  humo seguía sin ver el borrado porque el servidor tenía su copia. Ahora `upkeep.SondaClones` /
  `SondaGitHub`, una copia.
- El expediente le dice al redactor «este archivo YA NO EXISTE en main» en vez de mandarlo a usar
  herramientas que ya no tiene.

> **MEDICIÓN · 2026-09-02** — `canon -ronda <clones>` antes: «⚠ comparación parcial — frontend-monorepo:
> exit status 128» y 5 cambios; después: 7 cambios, onboarding con sus dos «no está en main», sin aviso.
> **MEDICIÓN · 2026-09-02** — humo.py con el paso 7 nuevo: servidor fresco, `POST /api/tareas/onboarding`
> (sólo borrados) → 202, 2 tareas repartidas y revisadas. 0 tokens. `Creditop-SAS/playground#63`.

**Lección:** la prueba de humo no lo encontró porque el servidor y el CLI tenían copias distintas de la
misma lógica y la de humo (servidor) era la rota. Validar en prod encontró en 10 minutos lo que tres
corridas de humo no: los dos hacen falta.

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
