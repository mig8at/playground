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
personales.

**El próximo paso es:** etiquetar qué nodo ayudó en consultas generales reales, comparar el recorrido
completo cuando vuelva a existir una credencial válida para el LLM generativo y decidir si
`findings` se revisa y sella por tandas explícitas.

## Frentes activos

- **Vigencia:** repetir alineación y referencias después de cambios relevantes en los repos.
- **Jev:** comparar calidad, abstenciones, latencia y superficie enviada al modelo generativo.
- **Findings:** mantener visible qué parte fue comprobada sin declarar revisado el nodo entero.

## Cómo se comprueba

`make context-lint`, `make context-jev-test`, `make context-jev ARGS='bench'` y las herramientas de
alineación y referencias. Una corrida Jev no verifica conocimiento ni renueva sellos.

## Registro

### 2026-09-19

Se absorbió `context-arbol-al-dia`. El router Jev quedó optativo y medido; el estado vigente se redujo
a esta tarea canónica y el detalle anterior permanece en Git.
