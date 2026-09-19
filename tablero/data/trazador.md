---
id: 91
title: "Trazador"
clase: proyecto
stage: evaluation
created: "2026-09-19T14:55:00-05:00"
context_nodes: [trazador, findings]
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Esta es la única tarea local del trazador. Sus etapas, cobertura y evidencia permanecen
determinísticas. Jev puede evaluarse como ayuda semántica para clasificar un reporte, decidir si hay
evidencia suficiente y puntuar severidad, sin sustituir el mapa de etapas.

No se han enviado mensajes de Slack, logs, identificadores ni trazas reales a TypeSafe. El siguiente
experimento debe usar casos sintéticos y estados sanitizados.

**El próximo paso es:** construir un banco sintético de incidentes con etiquetas para `Choice`,
`Noul` y `Score`, y medir abstenciones antes de diseñar cualquier integración con reportes reales.

## Pendientes

- [ ] Definir categorías de incidente que produzcan una decisión concreta en código.
- [ ] Diseñar un estado derivado sin mensajes, ids, teléfonos ni payloads crudos.
- [ ] Conservar el clasificador actual como recuperación durante todo el experimento.

## Registro

### 2026-09-19

Se creó la tarea canónica de la herramienta. No absorbió datos reales ni activó una integración.
