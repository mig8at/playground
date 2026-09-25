---
id: 86
title: "Harness"
clase: proyecto
stage: work
created: "2026-09-15T17:00:00-05:00"
canon: [creditopx]
jira: []
jira_title: ""
---

## Pendientes

- [ ] Que «Buró inyectado» gobierne también la categoría en una corrida del panel: hoy el motor evalúa con el reporte fijo del mock de centrales (score 654, 59 consultas, sin tarjetas), no con el inyectado. Camino probable: dictarle al mock el perfil del caso, como `LAMBDA=1` del caminador (`pkg/risk-lambda.ts`). Termina cuando una corrida del panel en local registra la misma categoría que predice «Categoría por entidad».

- [ ] Validar preparación, ejecución, progreso y resultado durante una corrida real.
- [ ] Migrar un llamador a la vez a las funciones de escritura seguras cuando se modifique.
- [ ] Migrar los specs de burós al lambda y conservar `source=lambda` como evidencia de participación.
- [ ] Mantener asserts, transiciones y veredicto como reglas determinísticas.
