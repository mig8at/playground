---
id: 92
title: "Workers"
clase: proyecto
stage: evaluation
created: "2026-09-19T14:55:00-05:00"
context_nodes: [architecture, findings]
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Esta es la única tarea local de workers. El planificador puede usar el router Jev de `context` con
`JEV=1`; la opción está apagada por defecto. Solo una sugerencia fuerte reduce la superficie inicial,
y el mapa completo sigue disponible si la pista falla o no alcanza. Un plan anterior solo se aplica
cuando su pregunta coincide exactamente con la consulta actual.

La prueba punta a punta con el LLM generativo sigue pendiente porque la credencial disponible no fue
válida. Eso no afecta el funcionamiento normal sin Jev.

**El próximo paso es:** cuando exista una credencial válida, comparar consultas generales iguales con
y sin `JEV=1`, midiendo archivos leídos, tokens, tiempo y calidad de la respuesta final.

## Pendientes

- [ ] Probar el recorrido completo con preguntas generales y sin datos sensibles.
- [ ] Etiquetar el nodo que realmente sirvió después de leer las fuentes.
- [ ] Mantener recuperación al mapa completo y comportamiento idéntico cuando Jev esté apagado.

## Registro

### 2026-09-19

Se creó la tarea canónica de workers para separar sus mejoras de las del corpus de `context`.
