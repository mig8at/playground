---
id: 84
title: "Tablero"
clase: proyecto
stage: work
created: "2026-09-14T21:40:00-05:00"
canon: []
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Esta es la única tarea local del tablero. La agenda, la retoma en frío y el cierre diario ya se
derivan de los archivos, Git, ramas y bitácora. La organización local cambia a siete contenedores
permanentes: una tarea por herramienta y `playground` para asuntos transversales o todavía sin Jira.

La consola inferior de ramas pertenece a la tarea enfocada: muestra una tabla y, a la derecha, sólo
los repos asociados a sus ramas medidas. Conserva **Ramas** en el pie al cerrarse. Cada tarea tiene
una ruta copiable (`#/tareas/context`, `#/tareas/core-543`) que restaura la tarea al recargar y
responde a atrás/adelante.

La cabecera de la tarea concentra sprint, puntos, tiempo en Jira y los enlaces de contexto local. El
sidebar derecho ya no repite una ficha de detalle: usa pestañas para Jira, pendientes, hallazgos,
registro, bitácora y prototipos. Jira abre primero, ocupa todo el alto y muestra la descripción sin
marco de tarjeta. En ventanas medianas el sidebar se pliega y se recupera desde el pie.

La pulida visual comparte una sola gramática entre regiones: filas activas de superficie suave,
pestañas compactas con el mismo estado seleccionado, controles agrupados y tablas con seguimiento al
pasar el cursor. La consola evita repetir el conteo de ramas y conserva toda la información operativa.

La recarga ahora pinta el último snapshot correcto del sprint y restaura la ruta inmediatamente. Jira
se revalida por `fetch` en segundo plano, las fuentes locales cargan en paralelo y el pie muestra el
estado de sincronización; una respuesta remota lenta ya no desmonta el editor ni la consola.

Cada tarea de Jira muestra en su fila un icono para avanzar. Al abrirlo consulta las transiciones
reales y ofrece sólo el paso siguiente del flujo normal, sin mezclar bloqueos, invalidaciones ni
retrocesos. La tabla de ramas fija Rama y PR durante el desplazamiento, explica los estados de
ambientes y usa una fecha de medición relativa. Una tarea sin ramas conserva una franja compacta.

El laboratorio Jev de tablero está apagado por defecto. Sobre una retoma mínima pregunta en paralelo
el siguiente tipo de acción, el bloqueo externo y la urgencia. El banco sintético repetido dio 16/16
en las tres etiquetas, con 15 sugerencias y una revisión manual; una retoma real quedó etiquetada en
preview y no se envió.

`make retomar N=<id> BRIEF=1` suma al final la ficha de cada tema de canon que la tarea declara en
`canon:`, hasta cuatro; `BRIEF=a,b` elige. La ficha sale de `GET /api/read` de canon (no de un modelo)
y decide qué `context.md` se abre, no lo reemplaza.

**Frente abierto (2026-09-23): el código del tablero pasa a inglés — identificadores, archivos y
carpetas.** Pedido de Miguel; extiende a esta herramienta la regla que ya regía en los repos de la
compañía (identificadores en inglés, comentarios en español). El contenido de `data/` —las tareas, sus
títulos de sección y el frontmatter que se escribe a mano— **no** entra: es texto, no código. Detalle,
fases e inventario en «Frente: el código en inglés», abajo.

**El próximo paso es:** decidir las dos preguntas de la fase 0 del frente (¿`tablero` y los targets de
`make` se quedan como nombres propios? ¿el JSON de la API cambia en esta tanda o en otra?) y arrancar
la fase 1, que no rompe ningún contrato.

> **MEDICIÓN · 2026-09-19** — sobre la tarea KYC #47, el Markdown completo pesa 64.571 bytes; la proyección compacta pesa 6.243 bytes (**90,3 % menos**) y la variante con borrador 11.856 bytes.
> make tarea-json N=47; make tarea-json N=47 CONTENIDO=1; wc -c

> **MEDICIÓN · 2026-09-21** — sobre la tarea KYC #47: la retoma pesa 3.832 bytes; con `BRIEF=1` 18.540 bytes (sus tres fichas) contra 96.313 de sus tres `doc.md` (**80,8 % menos** que abrirlos). La ficha de `kyc` sola: 5.074 bytes contra 55.302 de su doc. Las 24 tareas vivas declaran `context_nodes`: al retomar no hay nodo que elegir, así que Jev `route` ahí no ahorra nada.
> make retomar N=47; make retomar N=47 BRIEF=1; cat context/server/data/flows/{kyc,credifamilia,deceval}/doc.md | wc -c

## Pendientes

- [ ] **El cierre pide bitácora por una tarea que sólo recibió un barrido de rutas.** Medido el
      2026-09-21: mudar las trampas del sistema cambió UNA línea en `#46` y `#47` —la ruta del
      archivo, nada del trabajo— y el cierre exigió bitácora del día en las dos. Anotar minutos ahí
      sería inventar tiempo, y ese dato sube a Jira. El caso análogo ya está resuelto para el
      frontmatter (`soloMetadatos`, que no reclama cuando lo único que cambió es un metadato);
      falta el equivalente para un cambio que **no toca ninguna afirmación** de la tarea. Una pista
      barata: si el diff del cuerpo son sólo rutas o enlaces, no es trabajo.

- [ ] Nombres en inglés · fase 0: decidir el alcance de los nombres propios y del JSON; termina
      cuando las dos respuestas quedan anotadas como DECISIÓN en el frente.
      Depende de: Miguel — si `tablero`, `make tareas/retomar/cierre/hoy/bitacora` y el `pulso` se
      renombran o se quedan.
- [ ] Nombres en inglés · fase 1: identificadores internos de Go y Vue; termina con la batería de
      «Cómo se comprueba» del frente en verde y las salidas de consola idénticas byte a byte.
- [ ] Nombres en inglés · fase 2: archivos; termina cuando no queda ningún archivo con nombre en
      español fuera de `data/` y el `anotacion.spec.ts` del arnés sigue verde.
- [ ] Nombres en inglés · fase 3: carpetas; termina con Makefile, hooks y LaunchAgent del pulso
      reapuntados y un pulso nuevo escrito después del cambio.
- [ ] Nombres en inglés · fase 4: un chequeo que frene nombres nuevos en español; termina cuando
      el chequeo sale ≠0 con un identificador en español inventado a propósito.
- [ ] Sacar los 5 colores literales del resaltado SQL de `src/App.vue` a tokens; termina cuando
      `make estilo-check` sale 0 (hoy falla sólo por eso, chequeo 6).
- [ ] Resolver el contenedor `cuadrilla` (#93): el lint lo marca fuera de los siete nombres
      canónicos; termina cuando `make tareas TODAS=1` no muestra el ⚠ — sumándolo a la lista o
      absorbiéndolo en `playground`.
- [ ] Actualizar `docs/ARQUITECTURA.md`: su «Recorrido diario» describe un panel con pestañas
      Trabajo, Hallazgos y Ramas que ya no existe; termina cuando coincide con la tabla de regiones de
      `CLAUDE.md`.
- [ ] Comprobar que ninguna tarea local nueva nazca fuera de los siete nombres canónicos.
- [ ] Confirmar que bitácora y retoma siguen agrupadas bajo la herramienta correcta.
- [ ] Medir cuántos archivos y tokens evita `make tarea-json` en una retoma real con workers.
- [ ] Reunir una muestra representativa de etiquetas antes de comparar Jev con trabajo real.
- [ ] Medir, en una semana de retomas reales, cuántas veces la ficha de `BRIEF=1` alcanzó y cuántas se abrió el doc igual — si es siempre, la ficha no está decidiendo nada.

## Frente: el código en inglés

**Objetivo.** Todo lo que alguien escribe al INVOCAR el tablero —identificadores, nombres de archivo y
de carpeta— en inglés. Lo que se lee para ENTENDER —comentarios, docblocks, `CLAUDE.md`, las tareas de
`data/`— queda en español. Es la misma prueba que ya rige en los repos de la compañía.

**Inventario medido el 2026-09-23** (fuera de `data/`, `node_modules/` y `dist/`):

| capa | en español | quién más lo lee |
|---|---|---|
| funciones y tipos Go | 129 de 469 (`Anotaciones`, `FuentesDe`, `ProximoPaso`, `MedirRamas`, `Retoma`…) | el arnés lee el regex `reAnotacion` de `store/anotaciones.go` por RUTA y NOMBRE |
| identificadores JS/Vue | 78 de 536 declarados | nadie de afuera |
| etiquetas JSON de la API | 31 (`proximoPaso`, `pendientesAbiertos`, `diasSinTocar`, `ramasPatron`…) | el front, los hooks y el contrato `tablero.tarea.v1` |
| archivos | 22 (`store/{anotaciones,fuentes,retoma,pendientes,ramas,toques}.go` y sus tests, `tools/{ramas,citas,trampas}.py`, `PLANTILLA-TAREA*.md`, `ARQUITECTURA.md`) | `Makefile` raíz, hooks, `CLAUDE.md` raíz, 4 tareas |
| carpetas | 8 (`server/cmd/{hoy,cierre,ramas,tareas,bitacora,pulso,cuadrilla}`, `internal/pulso`) + `data/trampas` | `Makefile` (26 líneas), `.claude/hooks/{cierre,tarea-lint}.py`, el LaunchAgent del pulso (ruta del binario) |

**Fases, en orden de riesgo** — cada una es un commit y termina en verde antes de la siguiente:

0. **Decidir los nombres propios.** El `CLAUDE.md` raíz dice que los nombres propios se quedan
   (`tablero`, `harness`) y los verbos van en inglés; los targets de `make` (`tareas`, `retomar`,
   `cierre`, `hoy`) son la interfaz que usan Miguel, los hooks y el catálogo del `SessionStart`.
   Propuesta: la carpeta `tablero` y los targets de `make` se quedan; lo de adentro se traduce. Y el
   JSON de la API va aparte (fase 4b) porque cambia un contrato versionado.
1. **Identificadores internos** (Go no exportados, JS/Vue): no cruzan ninguna frontera. `gopls rename`
   para Go, así no se escapa una referencia.
2. **Archivos.** `git mv` para no perder la historia. ⚠ El arnés busca `anotaciones.go` y
   `reAnotacion` por nombre: se reapunta `harness/pkg/anotacion.spec.ts` en el MISMO commit, o su
   prueba falla — y si falla por «no encontré», se lee como un rename, no como un error.
3. **Carpetas.** `server/cmd/*` cambia el nombre del binario: `Makefile`, los dos hooks y el plist
   del LaunchAgent (`bin/pulso`) van juntos. ⚠ Un pulso que deja de escribir no avisa: se lee como un
   día sin trabajo.
4. **Cablearlo.** Un chequeo en `make` que falle con un identificador nuevo en español (lista de
   raíces del dominio: tarea, rama, pendiente, anotación, fuente, retoma, cierre…), porque una regla
   escrita envejece y un chequeo no.
   4b. Si la fase 0 lo decide: etiquetas JSON, con el contrato subido a `tablero.tarea.v2`.

**Lo que NO entra.** El contenido de `data/` (tareas, títulos de sección como «Si retomás esto sin
contexto», frontmatter `ramas:`/`canon:`), los mensajes que imprime la consola y los comentarios. El
parser lee esos títulos de sección: traducirlos obligaría a migrar las 46 tareas, y las publicadas no
se migran (decisión del 2026-08-20).

**Cómo se comprueba cada fase.** Antes de empezar se guardan las salidas de consola y se comparan
después — un rename correcto no cambia ni un byte:

    make tareas TODAS=1 JSON=1 > antes-tareas.json; make tarea-json N=47 > antes-47.json
    make retomar N=47 > antes-retomar.txt; make cierre JSON=1 > antes-cierre.json
    cd tablero/server && go vet ./... && go test -count=1 ./...
    cd tablero && npm test && npx vite build
    cd tablero/tools && python3 -m unittest test_jev test_ramas
    make estilo-check · make trampas · (fase 2) el `anotacion.spec.ts` del arnés

## Cómo se comprueba

`make tareas TODAS=1`, `make tarea-json N=tablero`, `make tablero-jev-test`, los tests del servidor
(`go test ./cmd/hoy/` cubre el tope y los errores de `BRIEF=`), `make retomar N=47 BRIEF=1` y
`make cierre JSON=1`.

## Registro

### 2026-09-23

Validación completa del tablero: `go vet` limpio, `go test` verde en los 10 paquetes con pruebas
(ninguna saltada), 14 pruebas de Node, 18 de Python y el build de Vite pasan. Los lints propios
encontraron tres cosas: `estilo-check` falla por 5 colores literales en el resaltado SQL, el lint de
tareas marca `cuadrilla` (#93) fuera de los siete contenedores, y `make trampas` tiene una cita que ya
no existe en `main`. Además la retoma de esta tarea seguía describiendo `BRIEF=` contra `context/`,
que se apagó el 2026-09-21: se reescribió contra canon. Se abrió el frente «el código en inglés» con
su inventario medido.

### 2026-09-21

`make retomar` acepta `BRIEF=`: al final imprime la ficha de cada nodo de context declarado, corriendo
`context/tools/jev.py brief --text`, con tope de cuatro y `BRIEF=a,b` para elegir. Salió de medir el
arranque de una tarea: Jev no tenía nada que elegir —las 24 tareas vivas ya declaran nodos— y el gasto
estaba en abrir los `doc.md` (mediana 27 KB; `kyc` 55 KB). Un brief que falla queda como error en su
ficha; un nodo pedido que la tarea no declara se marca. Con `JSON=1` el brief viaja como JSON bajo
`context`. La regla de corte quedó en los tres `CLAUDE.md`: si la ficha no contesta, la pregunta va a
`workers/`, no a otro nodo.

### 2026-09-19

Se absorbió `tablero-retomar-en-frio` y se aplicó la consolidación de todas las tareas locales. La
API ya no crea tareas locales sueltas; el CLI también las detecta y hace fallar el lint.

La tarea ahora tiene una proyección JSON tipada y generada desde el Markdown. Expone el estado
operativo sin copiar todo el cuerpo privado y deja el texto largo como evidencia consultable.

La consola de ramas pasó al panel inferior del Tablero, abierta por defecto y recuperable desde el
pie. Después se retiró la vista duplicada del sidebar derecho y se acotó el selector a los repos de
la tarea enfocada. Las tareas locales y de Jira recibieron rutas hash estables que sobreviven a la
recarga. La pulida responsive prioriza la lectura, fija la identidad de cada rama al desplazar la
tabla y vuelve explícitos los pendientes, la antigüedad de la medición y los estados de ambientes.
