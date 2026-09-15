---
id: 84
title: "Tablero: retomar cualquier tarea en frío, y que el cierre no dependa de acordarse"
stage: work
created: "2026-09-14T21:40:00-05:00"
context_nodes: []
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Miguel pidió (14/9) mejoras al tablero para «tener ordenado el día a día y poder retomar cualquier
tarea». El diagnóstico se midió sobre las 39 abiertas: 23 sin sección de retoma, 27 sin próximo paso,
21 sin tocar hace más de 3 semanas, 3 con Registro y sin bitácora en septiembre, y `make tareas`
decía 63 abiertas por un parser roto. **La causa común: el cierre de sesión era una lista en
`tablero/CLAUDE.md`, no un chequeo.** Hoy ya no: `make cierre` existe y el hook de `Stop` lo corre
solo (commit `678343e`). No hay que volver a medir el diagnóstico; está en el Registro.

**El próximo paso es:** escribir `make retomar N=x` (sección de retoma + próximo paso + último
Registro + snapshot de ramas + última bitácora, y en rojo lo que no exista).

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

1. ✔ `make cierre` + hook. 2. ✔ conteo de abiertas e ids repetidos. 3. `make retomar N=x`.
4. «días sin tocar» en la tarjeta, medido con git: dormida a los 14, proponer archivar a los 30.
5. `make bitacora` con la columna del pulso del mismo día y los minutos sin tarea.
6. Migrar a la plantilla sólo las abiertas en `work` tocadas en las últimas 4 semanas (~12).

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

> **MEDICIÓN · 2026-09-14** — `make cierre` sobre hoy: 6 tareas tocadas, 19 piezas faltantes, 3 ramas sin dueño, 60′ de bitácora sin tarea. Sobre el 10/9: 4 tocadas, 10 piezas, 151′ sin tarea.
> `make cierre DIA=2026-09-10`

## Registro

### 2026-09-14

Diagnóstico medido sobre las 39 abiertas (arriba). Hecho: `make cierre` con `-dia/-json/-quiet`,
hook de `Stop` una vez por sesión, arreglo del conteo de `make tareas` (leía `archived` como
booleano y son fechas), guarda de ids repetidos en el store con test, y la tarea de Confluence
pasó del 79 al 83 porque colisionaba con una archivada. Descartados: `SessionEnd`, mirar el
transcript entero, fallar el store. Todo verificado corriéndolo contra hoy y contra el 10/9.

## Tarea (publicable)

## En una línea
El registro de trabajo del equipo avisa solo cuando una tarea queda sin lo necesario para retomarla.

## Por qué
Las tareas que se dejan varias semanas se retoman leyendo archivos largos que mezclan lo vigente con
lo histórico, y el cierre del día dependía de acordarse.

## Cómo validar
Trabajar en una tarea y terminar la sesión sin escribir su estado: tiene que aparecer el aviso con lo
que falta, una sola vez.
