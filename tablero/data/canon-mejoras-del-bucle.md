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

**El próximo paso es:** mergear #48, correr UNA vuelta completa en prod y anotar tres números: cuántos
`declarar` llegan con archivos nombrados, qué dictamina el verificador, y cuánto costó la vuelta entera.
Esos tres números ordenan el resto de esta lista.

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

### 1 · Persistir el plan: hoy un deploy resetea la vuelta

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

### 2 · La cola de cambios nuevos se calcula con lo que escribió el modelo

**Evidencia.** `enCola` compara los archivos de la ronda contra `t.fuentes`, que son los `archivos`
que el planificador escribió en texto libre — y **el esquema no le pide formato** (línea ~766: `array
of string`, sin `description`). A veces escribe `repo:ruta`, a veces sólo la ruta. La pantalla mostró
«7 en cola» de 15: plausible, pero no confiable.

**Cómo.** Cobertura del lado del servidor y determinista: cada tarea del plan tiene `Area`, y el área
tiene sus `fuentes` conocidas. `/api/tareas` devuelve `cubiertos` (repo:ruta) y el frente compara
contra eso. El texto libre del planificador deja de decidir nada.

### 3 · El tope de 20 corridas evicta las de la vuelta en curso

**Evidencia.** `const tope = 20` en `corridas.go:155`. Una vuelta de 4 tareas + reintentos +
consolidación + `proponer` son ~10 corridas; dos vueltas y una tarea del plan deja de encontrar la
suya, y la tarjeta vuelve a `lista` con el ▶ como si nunca hubiera corrido.

**Cómo.** No evictar las corridas que el plan referencia. Cinco líneas en `abrir`. Cuando el plan se
persista (ítem 1), persistir con él sus corridas cerradas.

### 4 · CI no corre el detector de carreras

**Evidencia.** `Dockerfile:15` corre `go vet ./... && go test ./...` — sin `-race`. Hoy se arreglaron
cuatro carreras de datos reales (verificadas con `-race`: el patrón viejo las marca). Si vuelven, CI
no las ve.

**Cómo.** `-race` necesita cgo, y `golang:1.23-alpine` no trae gcc. Dos opciones: `apk add gcc
musl-dev` en la etapa de compilación (+40 s de build), o un paso `go test -race ./...` en el workflow
`revisar` con `setup-go`, fuera de Docker. **La segunda**: no engorda la imagen y corre en paralelo.

### 5 · `no alcanza` casi siempre es «el archivo no está declarado», disfrazado

**Evidencia.** En prod, `no alcanza` fue el veredicto dominante y `declarar` el siguiente (4 de 7).
Leyendo los detalles, buena parte de los `no alcanza` dicen «la lógica está en X y X no está en el
área» — o sea, un `declarar` que el redactor no supo nombrar como tal.

**Cómo.** Que `no alcanza` pueda llevar `archivos` (qué le habría hecho falta), igual que `declarar`.
El aplicador mecánico ya existe: con un click una persona declara lo que el agente pidió, y la
próxima vuelta ese redactor concluye en vez de rendirse. Cambio de esquema + botón en la página de la
tarea. **Medir en prod** cuántos `no alcanza` traen archivos.

### 6 · El costo de una vuelta con Sonnet, y el techo de 120k

**Evidencia.** En prod, 3 de 4 redactores llegaron al techo de 120k tokens. La ley de costo está
medida: el contenido del prompt se paga una vez; cada turno reenvía el historial entero, así que el
costo crece con el cuadrado de los turnos. Las instrucciones de presupuesto NO aterrizan en Sonnet
(las de formato sí): el tope de 6 búsquedas tuvo que ir en código.

**Cómo.** Primero medir una vuelta entera en prod con la pantalla nueva (el costado ya suma tokens).
Después, en orden: (a) `leer` devuelve la SECCIÓN y no el tema entero salvo pedido explícito — hoy el
redactor lee ~9.000 palabras para contestar sobre una; (b) recortar la salida de `codigo` a las
funciones que nombra la afirmación; (c) bajar el tope de turnos del redactor de 16 a 10 y medir
cuántos concluyen igual. Cada uno se mide en prod por separado, porque local no muestra el costo.

### 7 · Ids estables entre reanálisis

**Evidencia.** Los ids son posicionales (`p1`, `p2`). La guarda de la firma evita que un veredicto se
pegue a otra pregunta, pero `/agentes/p1` sigue apuntando a otra cosa después de reanalizar: el enlace
que alguien pegó en Slack cambia de significado.

**Cómo.** `id` = hash corto de `tema + primera afirmación`. Con eso la guarda de la firma se vuelve
redundante (misma pregunta ⇒ mismo id) y los enlaces sobreviven. Tocar `tarjetasDePlan` y el frente.

### 8 · Tres pequeñas, de una tarde

- **`/api/estado` pesa** (5 lecturas a GitHub) y se pide en cada entrada a `agentes`. Cachear 2 min,
  como `/api/pr`.
- **El chip del PR tarda hasta 2 min en aparecer** tras el primer `proponer`: `refrescar` llama a
  `/api/pr` y está cacheado. Al terminar `proponer`, pedir `/api/pr?forzar=1`.
- **El caño en vivo refresca tres endpoints por cada paso** de cada agente. Debounce de 500 ms en
  `escuchar`.

### 9 · `vigilar.md` está en el techo

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

> **DECISIÓN · 2026-09-01** — la vuelta la manda una persona desde `agentes`; nada corre solo.
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
