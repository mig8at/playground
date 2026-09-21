---
id: 89
title: "Context"
clase: proyecto
stage: work
created: "2026-09-19T08:00:00-05:00"
context_nodes: []
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

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

**El próximo paso es:** etiquetar qué nodo ayudó en consultas generales reales, comparar el recorrido
completo cuando vuelva a existir una credencial válida para el LLM generativo y decidir si
`findings` se revisa y sella por tandas explícitas.

## Frentes activos

- **Vigencia:** repetir alineación y referencias después de cambios relevantes en los repos.
- **Ramas:** usar la consola en el trabajo diario y ajustar la clasificación si aparece un estado que
  la comparación actual no distingue.
- **Jev:** comparar calidad, abstenciones, latencia y superficie enviada al modelo generativo.
- **Findings:** mantener visible qué parte fue comprobada sin declarar revisado el nodo entero.

## Cómo se comprueba

`make context-lint`, `make context-ramas`, `make context-ramas-test`, `make context-jev-test`,
`make context-jev ARGS='bench'`, `make estilo-ui` y las herramientas de alineación y referencias. Una
corrida Jev no verifica conocimiento ni renueva sellos.

## Registro

### 2026-09-21

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
